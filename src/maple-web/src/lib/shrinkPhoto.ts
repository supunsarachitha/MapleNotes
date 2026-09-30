// Shrinking photos in the browser before they upload (Settings → Features), so they take a fraction of the space.
// It happens before any encryption, so it works the same for end-to-end accounts.

/** Photos are shrunk to at most this many pixels on their longest side. */
export const MAX_PHOTO_SIDE = 2560;

const JPEG_QUALITY = 0.85;

/** The shrunk photo is kept only when it saves at least a tenth. */
const WORTHWHILE = 0.9;

// Still images a browser can usually decode. GIFs are left alone (they may be animated), and so is SVG.
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp", "image/heic", "image/heif"]);

/** Whether a file is a still image worth trying to shrink. */
export function canShrink(file: Pick<File, "type">): boolean {
  return SHRINKABLE.has(file.type.toLowerCase());
}

/** The size to draw an image at: at most `max` pixels on its longest side, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The shrunk photo's file name: the same name, as a .jpg. */
export function jpegName(name: string): string {
  return `${name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
}

function canvasOf(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return { context: canvas.getContext("2d"), toJpeg: () => canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY }) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    context: canvas.getContext("2d"),
    toJpeg: () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)),
  };
}

function hasTransparency(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] !== 255) return true;
  }
  return false;
}

/**
 * Shrinks a photo: upright (as its camera meant it), at most {@link MAX_PHOTO_SIDE} pixels on its longest side, re-saved
 * as a JPEG. Re-saving leaves out the location and camera details a photo may carry. Returns the file unchanged when the
 * browser cannot decode it, when it has transparent parts (which JPEG cannot keep), or when shrinking would hardly help.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!canShrink(file) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // a format this browser cannot decode, such as HEIC outside Safari
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const { context, toJpeg } = canvasOf(width, height);
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    if (file.type !== "image/jpeg" && hasTransparency(context, width, height)) return file;
    const jpeg = await toJpeg();
    if (!jpeg || jpeg.size > file.size * WORTHWHILE) return file;
    return new File([jpeg], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
