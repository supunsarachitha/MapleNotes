import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveWebp, canShrink, fitWithin, isAnimated, PHOTO_PRESETS, photoName, resetWebpCheck, shrinkPhoto } from "./shrinkPhoto";

/**
 * A stand-in for the browser's canvas: `webp` says whether it can save WebP (Safari hands back a PNG instead),
 * `transparent` whether the drawn picture has see-through parts, and `bytes` how big a saved picture is.
 */
function fakeBrowser({ webp, transparent = false, bytes = 1000 }: { webp: boolean; transparent?: boolean; bytes?: number }) {
  const saves: { type: string; quality: number; width: number; height: number }[] = [];
  class FakeCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return {
        imageSmoothingQuality: "low",
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, transparent ? 0 : 255]) }),
      };
    }
    async convertToBlob({ type, quality }: { type: string; quality: number }) {
      saves.push({ type, quality, width: this.width, height: this.height });
      return new Blob([new Uint8Array(bytes)], { type: type === "image/webp" && !webp ? "image/png" : type });
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close: () => {} }));
  return saves;
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngChunk = (name: string, length: number) => [...u32(length), ...ascii(name), ...new Array(length + 4).fill(0)];
/** The start of a PNG: the signature, then the named chunks in order. */
const png = (...chunks: [string, number][]) => [137, 80, 78, 71, 13, 10, 26, 10, ...chunks.flatMap(([name, length]) => pngChunk(name, length))];
/** The start of a WebP: `VP8X` with the given flags, or a plain `VP8 ` still picture. */
const webp = (chunk: "VP8X" | "VP8 ", flags = 0) => [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 10, 0, 0, 0, flags, 0, 0, 0];
/** The start of an AVIF: a `ftyp` box with a major brand and compatible brands. */
const avif = (major: string, ...compatible: string[]) => [...u32(16 + 4 * compatible.length), ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
const fileOf = (bytes: number[], name: string, type: string, padding = 100_000) =>
  new File([new Uint8Array([...bytes, ...new Array(padding).fill(0)])], name, { type, lastModified: 42 });

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebpCheck();
});

describe("telling animated pictures apart", () => {
  it("reads the animation markers of WebP, PNG and AVIF", async () => {
    expect(await isAnimated(fileOf(webp("VP8X", 0x02), "a.webp", "image/webp", 0))).toBe(true);
    expect(await isAnimated(fileOf(webp("VP8X", 0x3c), "a.webp", "image/webp", 0))).toBe(false); // ICC, alpha, EXIF and XMP only
    expect(await isAnimated(fileOf(png(["IHDR", 13], ["iCCP", 3000], ["acTL", 8], ["IDAT", 10]), "a.png", "image/png", 0))).toBe(true);
    expect(await isAnimated(fileOf(png(["IHDR", 13], ["IDAT", 10], ["IEND", 0]), "a.png", "image/png", 0))).toBe(false);
    expect(await isAnimated(fileOf(avif("avis"), "a.avif", "image/avif", 0))).toBe(true);
    expect(await isAnimated(fileOf(avif("avif", "mif1"), "a.avif", "image/avif", 0))).toBe(false);
  });

  it("says no for other types, and for files too short or not what they claim", async () => {
    expect(await isAnimated(fileOf(webp("VP8X", 0x02), "a.jpg", "image/jpeg", 0))).toBe(false);
    expect(await isAnimated(fileOf([1, 2, 3], "a.webp", "image/webp", 0))).toBe(false);
    expect(await isAnimated(fileOf([137, 80, 78, 71], "a.png", "image/png", 0))).toBe(false);
    expect(await isAnimated(fileOf(ascii("hello"), "a.avif", "image/avif", 0))).toBe(false);
    expect(await isAnimated(new File([], "empty.png", { type: "image/png" }))).toBe(false);
  });
});

describe("shrinking photos", () => {
  it("fits the longest side within 2560 pixels and never enlarges", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1920, height: 2560 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(10_000, 3)).toEqual({ width: 2560, height: 1 });
  });

  it("shrinks smaller photo sizes further, at a lower quality", () => {
    expect(PHOTO_PRESETS).toEqual({
      Large: { maxSide: 2560, quality: 0.85 },
      Medium: { maxSide: 1920, quality: 0.8 },
      Small: { maxSide: 1280, quality: 0.75 },
    });
    expect(fitWithin(4000, 3000, PHOTO_PRESETS.Medium.maxSide)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000, PHOTO_PRESETS.Small.maxSide)).toEqual({ width: 960, height: 1280 });
  });

  it("tries still images only", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "IMAGE/JPEG"]) expect(canShrink({ type })).toBe(true);
    for (const type of ["image/gif", "image/svg+xml", "video/mp4", "application/pdf", ""]) expect(canShrink({ type })).toBe(false);
  });

  it("names the result as a JPEG", () => {
    expect(photoName("IMG_1234.HEIC", "jpg")).toBe("IMG_1234.jpg");
    expect(photoName("screen shot.png", "jpg")).toBe("screen shot.jpg");
    expect(photoName("archive.tar.png", "jpg")).toBe("archive.tar.jpg");
    expect(photoName("photo", "jpg")).toBe("photo.jpg");
    expect(photoName(".png", "jpg")).toBe("photo.jpg");
  });

  it("names the result as a WebP", () => {
    expect(photoName("IMG_1234.HEIC", "webp")).toBe("IMG_1234.webp");
    expect(photoName("screen shot.png", "webp")).toBe("screen shot.webp");
    expect(photoName(".png", "webp")).toBe("photo.webp");
  });

  it("leaves alone what it should not or cannot shrink", async () => {
    const gif = new File(["GIF89a"], "cat.gif", { type: "image/gif" });
    const jpeg = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" }); // this environment decodes no images

    expect(await shrinkPhoto(gif)).toBe(gif);
    expect(await shrinkPhoto(jpeg)).toBe(jpeg);
  });

  describe("choosing WebP or JPEG", () => {
    const big = (name: string, type: string) => new File([new Uint8Array(100_000)], name, { type, lastModified: 42 });

    it("asks the browser once whether it can save WebP, from what it hands back", async () => {
      const saves = fakeBrowser({ webp: true });
      expect(await canSaveWebp()).toBe(true);
      expect(await canSaveWebp()).toBe(true);
      expect(saves).toEqual([{ type: "image/webp", quality: 0.8, width: 1, height: 1 }]);
    });

    it("finds that Safari cannot save WebP, because it hands back a PNG", async () => {
      fakeBrowser({ webp: false });
      expect(await canSaveWebp()).toBe(false);
    });

    it("says no when there is no canvas to ask", async () => {
      vi.stubGlobal("OffscreenCanvas", undefined);
      vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
      expect(await canSaveWebp()).toBe(false);
    });

    it("remembers that Safari cannot save WebP, without asking again", async () => {
      const saves = fakeBrowser({ webp: false });
      expect(await canSaveWebp()).toBe(false);
      expect(await canSaveWebp()).toBe(false);
      expect(saves).toHaveLength(1);
    });

    it("asks again when the check itself failed", async () => {
      const saves = fakeBrowser({ webp: true });
      const working = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = () => Promise.reject(new Error("out of memory"));
      expect(await canSaveWebp()).toBe(false);
      OffscreenCanvas.prototype.convertToBlob = working;
      expect(await canSaveWebp()).toBe(true);
      expect(await canSaveWebp()).toBe(true);
      expect(saves).toHaveLength(1);
    });

    it("asks only once when photos are shrunk at the same time", async () => {
      const saves = fakeBrowser({ webp: true });
      expect(await Promise.all([canSaveWebp(), canSaveWebp()])).toEqual([true, true]);
      expect(saves).toHaveLength(1);
    });

    it("saves photos as WebP where the browser can", async () => {
      const saves = fakeBrowser({ webp: true });
      const shrunk = await shrinkPhoto(big("IMG_1234.HEIC", "image/heic"), "Medium");
      expect(shrunk).toMatchObject({ name: "IMG_1234.webp", type: "image/webp", size: 1000, lastModified: 42 });
      expect(saves.at(-1)).toEqual({ type: "image/webp", quality: 0.8, width: 1920, height: 1440 });
    });

    it("saves photos as JPEG where the browser cannot save WebP", async () => {
      const saves = fakeBrowser({ webp: false });
      const shrunk = await shrinkPhoto(big("IMG_1234.HEIC", "image/heic"));
      expect(shrunk).toMatchObject({ name: "IMG_1234.jpg", type: "image/jpeg", size: 1000 });
      expect(saves.at(-1)).toEqual({ type: "image/jpeg", quality: 0.85, width: 2560, height: 1920 });
    });

    it("shrinks pictures with see-through parts as WebP, which keeps them", async () => {
      fakeBrowser({ webp: true, transparent: true });
      expect(await shrinkPhoto(big("logo.png", "image/png"))).toMatchObject({ name: "logo.webp", type: "image/webp" });
    });

    it("leaves pictures with see-through parts alone when they would have to be JPEG", async () => {
      fakeBrowser({ webp: false, transparent: true });
      const png = big("logo.png", "image/png");
      expect(await shrinkPhoto(png)).toBe(png);
    });

    it("leaves animated pictures alone, which would become still", async () => {
      const saves = fakeBrowser({ webp: true, transparent: true });
      for (const animated of [
        fileOf(webp("VP8X", 0x02 | 0x10), "sticker.webp", "image/webp"),
        fileOf(png(["IHDR", 13], ["acTL", 8], ["IDAT", 100]), "dance.png", "image/png"),
        fileOf(avif("avif", "mif1", "avis"), "loop.avif", "image/avif"),
      ]) {
        expect(await shrinkPhoto(animated)).toBe(animated);
      }
      expect(saves).toEqual([]); // not even drawn
    });

    it("still shrinks still PNG, WebP and AVIF pictures", async () => {
      fakeBrowser({ webp: true });
      for (const still of [
        fileOf(webp("VP8X", 0x10), "photo.webp", "image/webp"),
        fileOf(webp("VP8 "), "photo.webp", "image/webp"),
        fileOf(png(["IHDR", 13], ["IDAT", 100], ["acTL", 8]), "photo.png", "image/png"), // acTL after the picture data does not count
        fileOf(avif("avif", "mif1", "miaf"), "photo.avif", "image/avif"),
      ]) {
        expect(await shrinkPhoto(still)).toMatchObject({ type: "image/webp" });
      }
    });

    it("keeps the original when the WebP would hardly be smaller", async () => {
      fakeBrowser({ webp: true, bytes: 95_000 });
      const photo = big("photo.jpg", "image/jpeg");
      expect(await shrinkPhoto(photo)).toBe(photo);
    });
  });
});
