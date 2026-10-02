import { describe, expect, it } from "vitest";
import { canShrink, fitWithin, jpegName, PHOTO_PRESETS, shrinkPhoto } from "./shrinkPhoto";

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

  it("leaves alone what it should not or cannot shrink", async () => {
    const gif = new File(["GIF89a"], "cat.gif", { type: "image/gif" });
    const jpeg = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" }); // this environment decodes no images

    expect(await shrinkPhoto(gif)).toBe(gif);
    expect(await shrinkPhoto(jpeg)).toBe(jpeg);
  });
});
