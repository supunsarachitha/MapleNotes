// Which files may be shown in the page, mirroring the server's UploadPolicy: only types that browsers display
// passively (images, audio, video, plain text). Everything else, including SVG and HTML, is only ever downloaded.
// Decrypted end-to-end files are served from this origin by the media service worker, so the same rule applies there.

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/flac",
  "text/plain",
]);

export const DOWNLOAD_CONTENT_TYPE = "application/octet-stream";

/** Content-Security-Policy for attachment responses: nothing may run, even if a file is opened directly. */
export const ATTACHMENT_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

export function canDisplayInline(contentType: string): boolean {
  return INLINE_TYPES.has(contentType.toLowerCase());
}

export function isInlineImage(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/") && canDisplayInline(contentType);
}
