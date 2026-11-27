import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { downloadName, useAttachmentSrc } from "../lib/mediaWorker";
import type { Attachment } from "../lib/types";
import { MAX_SCALE, NO_ZOOM, TAP_SCALE, clampZoom, distance, midpoint, zoomAround, type Point, type Zoom } from "../lib/zoom";
import { Spinner, cn } from "./ui";

const control =
  "flex size-11 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white";

/** A second tap within this many milliseconds, and this many pixels of the first, is a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** A finger that moves further than this is dragging, not tapping. */
const TAP_SLOP_PX = 10;
/** A drag at least this far sideways at normal size is a swipe to the next or previous image. */
const SWIPE_PX = 50;

/**
 * The image fitted to the screen, with touch zoom: pinch, or double-tap to zoom in at that point (and again to go
 * back). A one-finger drag pans while zoomed in, or at normal size swipes to the next or previous image.
 */
function ZoomableImage({ image, onSwipe }: { image: Attachment; onSwipe?: (step: number) => void }) {
  const src = useAttachmentSrc(image);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [smooth, setSmooth] = useState(false);
  const current = useRef<Zoom>(NO_ZOOM);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({ start: NO_ZOOM, from: [] as Point[], down: { x: 0, y: 0 }, moved: false, pinched: false });
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  function apply(next: Zoom, animate: boolean) {
    const img = picture.current;
    const box = frame.current;
    const shown = { width: img?.offsetWidth ?? 0, height: img?.offsetHeight ?? 0 };
    const clamped = clampZoom(next, shown, { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 });
    current.current = clamped;
    setSmooth(animate);
    setZoom(clamped);
  }

  function pointOf(event: PointerEvent): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  }

  /** Starts the gesture again from where it is now, e.g. when a finger is added or lifted. */
  function restart() {
    gesture.current.start = current.current;
    gesture.current.from = [...pointers.current.values()];
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointOf(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) gesture.current = { ...gesture.current, down: point, moved: false, pinched: false };
    else gesture.current.pinched = true;
    restart();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = pointOf(event);
    pointers.current.set(event.pointerId, point);
    const { start, from } = gesture.current;
    const [first, second] = from;
    const [a, b] = [...pointers.current.values()];
    if (!first) return;
    if (a && b && second) {
      const spread = distance(first, second);
      const scale = Math.min(MAX_SCALE, Math.max(1, spread > 0 ? (start.scale * distance(a, b)) / spread : start.scale));
      apply(zoomAround(start, scale, midpoint(first, second), midpoint(a, b)), false);
      return;
    }
    const dx = point.x - first.x;
    const dy = point.y - first.y;
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) gesture.current.moved = true;
    if (start.scale > 1) apply({ ...start, x: start.x + dx, y: start.y + dy }, false);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size > 0) return restart(); // one finger of a pinch lifted: carry on panning with the other
    const { down, moved, pinched } = gesture.current;
    if (pinched || event.type === "pointercancel") return void (lastTap.current = null);
    const point = pointOf(event);
    const dx = point.x - down.x;
    if (current.current.scale === 1 && onSwipe && Math.abs(dx) > SWIPE_PX) return onSwipe(dx < 0 ? 1 : -1);
    if (moved) return void (lastTap.current = null);
    const tap = lastTap.current;
    const now = event.timeStamp;
    if (tap && now - tap.at < DOUBLE_TAP_MS && distance(tap.point, point) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      apply(current.current.scale > 1 ? NO_ZOOM : zoomAround(NO_ZOOM, TAP_SCALE, point), true);
    } else lastTap.current = { at: now, point };
  }

  const zoomed = zoom.scale > 1;
  return (
    <div
      ref={frame}
      data-testid="zoom-frame"
      className={cn("flex size-full touch-none items-center justify-center overflow-hidden", zoomed && "cursor-grab")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {src ? (
        <img
          ref={picture}
          src={src}
          alt={image.fileName}
          draggable={false}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            transition: smooth ? "transform 200ms ease-out" : undefined,
          }}
          className="max-h-full max-w-full select-none object-contain will-change-transform"
        />
      ) : (
        <Spinner className="size-8 text-white/70" />
      )}
    </div>
  );
}

function DownloadLink({ image }: { image: Attachment }) {
  const href = useAttachmentSrc(image, { download: true });
  return (
    <a href={href} download={downloadName(image, href)} aria-label={`Download ${image.fileName}`} className={control}>
      <Download className="size-5" />
    </a>
  );
}

/**
 * A full-screen viewer for a note's images: the image fitted to the screen, pinch or double-tap to zoom in (drag to
 * pan), previous and next (buttons, arrow keys or a swipe at normal size), a download link, and Esc or the close
 * button to leave. Each image opens at normal size. End-to-end images are decrypted like in the note.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: Attachment[];
  /** The image shown, or null when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && images[index] !== undefined;
  const image = open ? images[index] : undefined;
  const many = images.length > 1;
  const go = (step: number) => index !== null && onIndexChange((index + step + images.length) % images.length);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight" && many) go(1);
    else if (event.key === "ArrowLeft" && many) go(-1);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm" />
        <Dialog.Content
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <div className="flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Dialog.Title className="min-w-0 flex-1 truncate px-2 text-sm">
              {image?.fileName}
              {many && index !== null && <span className="ml-2 text-white/60">{`${index + 1} / ${images.length}`}</span>}
            </Dialog.Title>
            {image && <DownloadLink image={image} />}
            <Dialog.Close className={control} aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {image && <ZoomableImage key={image.id} image={image} onSwipe={many ? go : undefined} />}
            {many && (
              <>
                <button type="button" aria-label="Previous image" onClick={() => go(-1)} className={cn(control, "absolute left-3 top-1/2 -translate-y-1/2")}>
                  <ChevronLeft className="size-6" />
                </button>
                <button type="button" aria-label="Next image" onClick={() => go(1)} className={cn(control, "absolute right-3 top-1/2 -translate-y-1/2")}>
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
