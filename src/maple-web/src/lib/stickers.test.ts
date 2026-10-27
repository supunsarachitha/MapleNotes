// @vitest-environment node
import "fake-indexeddb/auto";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MAX_STICKER_BYTES,
  addStickerPack,
  cleanName,
  listStickerPacks,
  packSlug,
  readStickerPack,
  removeStickerPack,
  sniffPicture,
  stickerFile,
  stickerName,
} from "./stickers";

// Sticker packs, ported from Falcon Notes (StickerPacks.cs, docs/04 Stickers): what a ZIP file must hold to be one,
// and how packs are kept in this browser.

const png = (extra = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(4 + extra).fill(1)]);
const gif = () => new Uint8Array([...strToU8("GIF89a"), 0, 0, 0, 0]);
const webp = () => new Uint8Array([...strToU8("RIFF"), 1, 2, 3, 4, ...strToU8("WEBP"), 0, 0]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const zip = (files: Record<string, Uint8Array>) => new Blob([zipSync(files)], { type: "application/zip" });

describe("reading a sticker pack", () => {
  it("takes every picture in path order without a sticker-pack.json, named after the file", async () => {
    const { pack, pictures } = await readStickerPack(
      zip({
        "b/sleep.gif": gif(),
        "a/wave.png": png(),
        "README.txt": strToU8("hello"),
        "__MACOSX/a/._wave.png": png(),
        ".hidden.png": png(),
        "c/.secret/x.webp": webp(),
        "d/photo.JPG": jpeg(),
      }),
      "Café Friends!.zip",
      1234,
    );

    expect(pack).toMatchObject({ id: "cafe-friends", name: "Café Friends!", author: null, licence: null, version: null, added: 1234 });
    expect(pack.stickers).toEqual([
      { packId: "cafe-friends", file: "001.png", name: "wave", contentType: "image/png" },
      { packId: "cafe-friends", file: "002.gif", name: "sleep", contentType: "image/gif" },
      { packId: "cafe-friends", file: "003.jpg", name: "photo", contentType: "image/jpeg" },
    ]);
    expect([...pictures.keys()]).toEqual(["001.png", "002.gif", "003.jpg"]);
  });

  it("follows sticker-pack.json in the one top folder: its name, ID, author, licence and order", async () => {
    const manifest = {
      Id: "falcon-friends",
      name: "Falcon friends",
      author: "Supun",
      license: "CC0-1.0",
      version: "1.0",
      stickers: [{ file: "art/wave.webp", name: "Waving" }, { file: "/art/sleep.png" }],
    };
    const { pack } = await readStickerPack(
      zip({
        "pack/sticker-pack.json": strToU8(JSON.stringify(manifest)),
        "pack/art/sleep.png": png(),
        "pack/art/wave.webp": webp(),
        "pack/art/unlisted.png": png(),
      }),
      "whatever.zip",
    );

    expect(pack).toMatchObject({ id: "falcon-friends", name: "Falcon friends", author: "Supun", licence: "CC0-1.0", version: "1.0" });
    expect(pack.stickers.map((s) => [s.file, s.name])).toEqual([
      ["001.webp", "Waving"],
      ["002.png", "sleep"],
    ]);
  });

  it("reads each picture's type from its first bytes, and refuses anything else", async () => {
    expect(sniffPicture(png())).toBe("png");
    expect(sniffPicture(gif())).toBe("gif");
    expect(sniffPicture(webp())).toBe("webp");
    expect(sniffPicture(jpeg())).toBe("jpg");
    const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffPicture(svg)).toBeNull();

    await expect(readStickerPack(zip({ "evil.png": svg }), "p.zip")).rejects.toThrow(
      '"evil" is not a PNG, JPEG, GIF or WebP picture, so it cannot be a sticker.',
    );
  });

  it("refuses what is not a pack, with the reason", async () => {
    await expect(readStickerPack(new Blob(["not a zip at all"]), "notes.txt")).rejects.toThrow(
      "This file is not a sticker pack. A sticker pack is a ZIP file of pictures.",
    );
    await expect(readStickerPack(zip({ "README.md": strToU8("hi") }), "p.zip")).rejects.toThrow("This sticker pack has no pictures in it.");
    await expect(
      readStickerPack(zip({ "sticker-pack.json": strToU8(JSON.stringify({ stickers: [{ file: "gone.png" }] })), "a.png": png() }), "p.zip"),
    ).rejects.toThrow('This sticker pack lists "gone.png", which is not in it.');
    await expect(readStickerPack(zip({ "sticker-pack.json": strToU8("{ nope"), "a.png": png() }), "p.zip")).rejects.toThrow(
      "This sticker pack's sticker-pack.json could not be read.",
    );
    await expect(readStickerPack(zip({ "big.png": png(MAX_STICKER_BYTES) }), "p.zip")).rejects.toThrow(
      '"big" is too large for a sticker: a sticker can be at most 2 MB.',
    );
    const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`s${String(i).padStart(3, "0")}.png`, png()]));
    await expect(readStickerPack(zip(many), "p.zip")).rejects.toThrow("A sticker pack can have at most 300 stickers; this one has 301.");
  });

  it("cleans names and makes IDs as Falcon Notes does", () => {
    expect(cleanName("  Wave\u0007 ")).toBe("Wave");
    expect(cleanName("x".repeat(70))).toHaveLength(60);
    expect(cleanName(" \n ")).toBeNull();
    expect(packSlug("Ünïcode -- Pack_2")).toBe("unicode-pack-2");
    expect(packSlug("!!!")).toBeNull();
    expect(packSlug("a".repeat(39) + " b")).toBe("a".repeat(39));
    expect(stickerName("Waving cat.png")).toBe("Waving cat");
  });
});

describe("sticker packs in this browser", () => {
  it("adds, replaces by ID and removes packs, keeping each sticker's picture", async () => {
    const first = await addStickerPack(zip({ "wave.png": png(), "sleep.gif": gif() }), "Friends.zip");
    expect(first.replaced).toBe(false);
    await addStickerPack(zip({ "a.webp": webp() }), "Another pack.zip");
    expect((await listStickerPacks()).map((p) => p.name)).toEqual(["Another pack", "Friends"]);

    const file = await stickerFile(first.pack.stickers[1]!);
    expect(file?.name).toBe("wave.png");
    expect(file?.type).toBe("image/png");
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(png());

    const second = await addStickerPack(zip({ "only.gif": gif() }), "friends.zip");
    expect(second.replaced).toBe(true);
    const friends = (await listStickerPacks()).find((p) => p.id === "friends")!;
    expect(friends.stickers.map((s) => s.name)).toEqual(["only"]);
    // The replaced pack's other pictures are gone with it.
    expect(await stickerFile(first.pack.stickers[1]!)).toBeNull();

    await removeStickerPack("friends");
    expect((await listStickerPacks()).map((p) => p.id)).toEqual(["another-pack"]);
    expect(await stickerFile(friends.stickers[0]!)).toBeNull();
    await removeStickerPack("another-pack");
  });
});
