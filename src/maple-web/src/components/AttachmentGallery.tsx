import { FileText } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../lib/format";
import { useAttachmentSrc } from "../lib/mediaWorker";
import type { Attachment } from "../lib/types";
import { ImageViewer } from "./ImageViewer";
import { cn, Spinner } from "./ui";

function GalleryImage({ image, single, onOpen }: { image: Attachment; single: boolean; onOpen: () => void }) {
  const src = useAttachmentSrc(image);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${image.fileName}`}
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500 dark:border-stone-800 dark:bg-stone-800",
        single ? "max-w-full self-start" : "aspect-square w-full",
        !src && single && "min-h-40 w-full",
      )}
    >
      {src ? (
        <img
          src={src}
          alt={image.fileName}
          loading="lazy"
          decoding="async"
          // One image keeps its shape at up to its own size; several become square thumbnails.
          className={single ? "block h-auto max-h-[70vh] w-auto max-w-full object-contain" : "size-full object-cover"}
        />
      ) : (
        <Spinner className="size-5 text-stone-400" />
      )}
    </button>
  );
}

function VideoPlayer({ video }: { video: Attachment }) {
  const src = useAttachmentSrc(video);
  return (
    <video src={src} controls preload="metadata" aria-label={video.fileName} className="w-full rounded-xl bg-black">
      <track kind="captions" />
    </video>
  );
}

function AudioPlayer({ clip }: { clip: Attachment }) {
  const src = useAttachmentSrc(clip);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-stone-500 dark:text-stone-400">{clip.fileName}</span>
      <audio src={src} controls preload="metadata" className="w-full" />
    </div>
  );
}

function FileLink({ file }: { file: Attachment }) {
  const href = useAttachmentSrc(file, { download: true });
  return (
    <a
      href={href}
      download={file.endToEnd ? file.fileName : undefined}
      aria-disabled={!href}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
    >
      <FileText className="size-4 shrink-0 text-maple-600 dark:text-maple-400" aria-hidden="true" />
      <span className="truncate">{file.fileName}</span>
      <span className="shrink-0 text-stone-500 dark:text-stone-400">{formatBytes(file.sizeBytes)}</span>
    </a>
  );
}

/** A thumbnail of an attachment already stored (the composer's list when editing a note). */
export function AttachmentThumbnail({ attachment }: { attachment: Attachment }) {
  const src = useAttachmentSrc(attachment);
  return src ? <img src={src} alt={attachment.fileName} className="size-full object-cover" /> : <Spinner className="size-4 text-stone-400" />;
}

/**
 * Images (one at its own shape, several as a grid of thumbnails, each opening the image viewer), audio and video with native players, other files as download chips. End-to-end files are
 * decrypted in the browser (see useAttachmentSrc).
 */
export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.isImage);
  const videos = attachments.filter((a) => a.contentType.startsWith("video/") && !a.isImage);
  const audio = attachments.filter((a) => a.contentType.startsWith("audio/"));
  const files = attachments.filter((a) => !images.includes(a) && !videos.includes(a) && !audio.includes(a));

  return (
    <div className="mt-3 flex flex-col gap-2">
      {images.length > 0 && (
        <div className={cn("gap-2", images.length === 1 ? "flex" : "grid grid-cols-2", images.length >= 3 && "sm:grid-cols-3")}>
          {images.map((image, index) => (
            <GalleryImage key={image.id} image={image} single={images.length === 1} onOpen={() => setViewing(index)} />
          ))}
        </div>
      )}
      <ImageViewer images={images} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />

      {videos.map((video) => (
        <VideoPlayer key={video.id} video={video} />
      ))}

      {audio.map((clip) => (
        <AudioPlayer key={clip.id} clip={clip} />
      ))}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li key={file.id}>
              <FileLink file={file} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
