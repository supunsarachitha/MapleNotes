// Preparing an image to become the app's icon (Settings → Administration): drawn whole and centred on a square, so
// every icon has the same shape, and small enough for the server (at most 256 KB).

const SIZE = 256;
const MAX_BYTES = 256 * 1024;

/** Draws an image into a 256 × 256 icon: a PNG (keeping transparency), or a JPEG if a PNG would be too large. */
export async function squareIcon(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image could not be read. Try another PNG, JPEG or WebP file.");
  }
  try {
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
    const [width, height] = [Math.round(bitmap.width * scale), Math.round(bitmap.height * scale)];
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the icon.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return png.size <= MAX_BYTES ? png : await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  } finally {
    bitmap.close();
  }
}
