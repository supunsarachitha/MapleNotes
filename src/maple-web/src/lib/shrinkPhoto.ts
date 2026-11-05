// Shrinking photos in the browser before they upload (Settings → Notes & files), so they take a fraction of the space.
// It happens before any encryption, so it works the same for end-to-end accounts.

import type { PhotoSize } from "./types";

/**
 * How far each photo size shrinks: the longest side in pixels, and the quality it is saved at (WebP or JPEG). Like the
 * "standard" and "HD" choices of messaging and photo apps, smaller photos are also saved at a lower quality, where it
 * shows least.
 */
export const PHOTO_PRESETS: Record<PhotoSize, { maxSide: number; quality: number }> = {
  Large: { maxSide: 2560, quality: 0.85 },
  Medium: { maxSide: 1920, quality: 0.8 },
  Small: { maxSide: 1280, quality: 0.75 },
};

/** Photos are shrunk to at most this many pixels on their longest side, at the largest size. */
export const MAX_PHOTO_SIDE = PHOTO_PRESETS.Large.maxSide;

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

/** The shrunk photo's file name: the same name, with the extension of the format it was saved in. */
export function photoName(name: string, extension: "jpg" | "webp"): string {
  return `${name.replace(/\.[^.]*$/, "") || "photo"}.${extension}`;
}

// How much of the start of a file is read to tell whether it is animated. PNG keeps its animation marker before the
// picture data, which can follow a large colour profile, so this is generous.
const HEADER_BYTES = 256 * 1024;

/**
 * Whether a PNG, WebP or AVIF file is animated. The browser draws only the first frame of an animation, so shrinking one
 * would turn it into a still picture. Read from the file itself: an animated WebP sets the animation flag in its
 * `VP8X` header, an animated PNG has an `acTL` chunk before its picture data, and an animated AVIF names the `avis`
 * brand in its `ftyp` box.
 */
export async function isAnimated(file: Blob): Promise<boolean> {
  const type = file.type.toLowerCase();
  if (type !== "image/png" && type !== "image/webp" && type !== "image/avif") return false;
  const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length = 4) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (type === "image/webp") {
    return bytes.length > 20 && text(0) === "RIFF" && text(8) === "WEBP" && text(12) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0;
  }
  if (type === "image/png") {
    for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
      const chunk = text(at + 4);
      if (chunk === "acTL") return true;
      if (chunk === "IDAT" || chunk === "IEND") return false;
    }
    return false;
  }
  if (bytes.length < 16 || text(4) !== "ftyp") return false;
  const end = Math.min(view.getUint32(0), bytes.length);
  if (text(8) === "avis") return true; // the major brand
  for (let at = 16; at + 4 <= end; at += 4) if (text(at) === "avis") return true; // the compatible brands
  return false;
}

type PhotoType = "image/webp" | "image/jpeg";

function canvasOf(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return { context: canvas.getContext("2d"), save: (type: PhotoType, quality: number) => canvas.convertToBlob({ type, quality }) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    context: canvas.getContext("2d"),
    save: (type: PhotoType, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality)),
  };
}

let webpAnswer: boolean | undefined;
let webpCheck: Promise<boolean> | undefined;

/** Saves a 1 × 1 picture as WebP: whether the browser handed back a WebP, or `undefined` when it could not say. */
async function askWebp(): Promise<boolean | undefined> {
  try {
    const { context, save } = canvasOf(1, 1);
    if (!context) return undefined;
    context.fillRect(0, 0, 1, 1);
    const saved = await save("image/webp", 0.8);
    return saved ? saved.type === "image/webp" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether this browser can save pictures as WebP, found by saving a 1 × 1 picture. Browsers that cannot (today Safari,
 * and every browser on an iPhone or iPad) quietly hand back a PNG instead, so the answer is read from the result rather
 * than guessed from the browser's name. A clear answer is remembered; when the check itself fails (no canvas, or the
 * browser short of memory), the photo is saved as JPEG and the next photo asks again.
 */
export function canSaveWebp(): Promise<boolean> {
  if (webpAnswer !== undefined) return Promise.resolve(webpAnswer);
  webpCheck ??= askWebp().then((answer) => {
    webpCheck = undefined;
    webpAnswer = answer;
    return answer ?? false;
  });
  return webpCheck;
}

/** Forgets the answer of {@link canSaveWebp}, for tests. */
export function resetWebpCheck(): void {
  webpAnswer = undefined;
  webpCheck = undefined;
}

function hasTransparency(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] !== 255) return true;
  }
  return false;
}

/**
 * Shrinks a photo: upright (as its camera meant it), at most the size's longest side (see {@link PHOTO_PRESETS}),
 * re-saved at the size's quality as WebP where the browser can save it (see {@link canSaveWebp}), and as JPEG otherwise.
 * Re-saving leaves out the location and camera details a photo may carry. Returns the file unchanged when it is
 * animated (see {@link isAnimated}), when the browser cannot decode it, when it has transparent parts and must be saved
 * as JPEG (which cannot keep them), or when shrinking would hardly help.
 */
export async function shrinkPhoto(file: File, size: PhotoSize = "Large"): Promise<File> {
  if (!canShrink(file) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    if (await isAnimated(file)) return file;
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // a file it cannot read, or a format this browser cannot decode, such as HEIC outside Safari
  }
  try {
    const { maxSide, quality } = PHOTO_PRESETS[size];
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const webp = await canSaveWebp();
    const { context, save } = canvasOf(width, height);
    if (!context) return file;
    context.imageSmoothingQuality = "high"; // a smoother downscale than the default, which keeps small sizes sharp
    context.drawImage(bitmap, 0, 0, width, height);
    if (!webp && file.type !== "image/jpeg" && hasTransparency(context, width, height)) return file;
    const type: PhotoType = webp ? "image/webp" : "image/jpeg";
    const saved = await save(type, quality);
    if (!saved || saved.type !== type || saved.size > file.size * WORTHWHILE) return file;
    return new File([saved], photoName(file.name, webp ? "webp" : "jpg"), { type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
