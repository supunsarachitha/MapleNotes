import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { downloadName, useAttachmentSrc } from "../lib/mediaWorker";
import type { Attachment } from "../lib/types";
import { Spinner, cn } from "./ui";

const control =
  "flex size-11 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white";

function ViewerImage({ image }: { image: Attachment }) {
  const src = useAttachmentSrc(image);
  return src ? (
    <img src={src} alt={image.fileName} draggable={false} className="max-h-full max-w-full select-none object-contain" />
  ) : (
    <Spinner className="size-8 text-white/70" />
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
 * A full-screen viewer for a note's images: the image fitted to the screen, previous and next (buttons, arrow keys or a
 * swipe), a download link, and Esc or the close button to leave. End-to-end images are decrypted like in the note.
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
  const swipeStart = useRef<number | null>(null);
  const open = index !== null && images[index] !== undefined;
  const image = open ? images[index] : undefined;
  const many = images.length > 1;
  const go = (step: number) => index !== null && onIndexChange((index + step + images.length) % images.length);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight" && many) go(1);
    else if (event.key === "ArrowLeft" && many) go(-1);
  }

  function onPointerUp(event: PointerEvent) {
    if (swipeStart.current === null || !many) return;
    const distance = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(distance) > 50) go(distance < 0 ? 1 : -1);
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
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onPointerDown={(event) => (swipeStart.current = event.clientX)}
            onPointerUp={onPointerUp}
          >
            {image && <ViewerImage key={image.id} image={image} />}
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
