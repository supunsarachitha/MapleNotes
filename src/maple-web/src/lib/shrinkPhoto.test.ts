import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveWebp, canShrink, fitWithin, jpegName, PHOTO_PRESETS, photoName, resetWebpCheck, shrinkPhoto } from "./shrinkPhoto";

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

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebpCheck();
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
    expect(jpegName("IMG_1234.HEIC")).toBe("IMG_1234.jpg");
    expect(jpegName("screen shot.png")).toBe("screen shot.jpg");
    expect(jpegName("archive.tar.png")).toBe("archive.tar.jpg");
    expect(jpegName("photo")).toBe("photo.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
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

    it("keeps the original when the WebP would hardly be smaller", async () => {
      fakeBrowser({ webp: true, bytes: 95_000 });
      const photo = big("photo.jpg", "image/jpeg");
      expect(await shrinkPhoto(photo)).toBe(photo);
    });
  });
});
