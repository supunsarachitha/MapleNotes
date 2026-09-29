import { FileText } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { Attachment } from "../lib/types";
import { cn } from "./ui";

/** Images as a grid, audio and video with native players, other files as download chips. */
export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.isImage);
  const videos = attachments.filter((a) => a.contentType.startsWith("video/") && !a.isImage);
  const audio = attachments.filter((a) => a.contentType.startsWith("audio/"));
  const files = attachments.filter((a) => !images.includes(a) && !videos.includes(a) && !audio.includes(a));

  return (
    <div className="mt-3 flex flex-col gap-2">
      {images.length > 0 && (
        <div className={cn("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.map((image) => (
            <a
              key={image.id}
              href={image.url}
              target="_blank"
              rel="noopener"
              className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-800"
            >
              <img
                src={image.url}
                alt={image.fileName}
                loading="lazy"
                decoding="async"
                className={cn("w-full object-cover", images.length === 1 ? "max-h-[28rem]" : "aspect-square")}
              />
            </a>
          ))}
        </div>
      )}

      {videos.map((video) => (
        <video key={video.id} src={video.url} controls preload="metadata" className="w-full rounded-xl bg-black">
          <track kind="captions" />
        </video>
      ))}

      {audio.map((clip) => (
        <div key={clip.id} className="flex flex-col gap-1">
          <span className="text-xs text-stone-500 dark:text-stone-400">{clip.fileName}</span>
          <audio src={clip.url} controls preload="metadata" className="w-full" />
        </div>
      ))}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li key={file.id}>
              <a
                href={`${file.url}?download=true`}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                <FileText className="size-4 shrink-0 text-maple-600 dark:text-maple-400" aria-hidden="true" />
                <span className="truncate">{file.fileName}</span>
                <span className="shrink-0 text-stone-500 dark:text-stone-400">{formatBytes(file.sizeBytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
