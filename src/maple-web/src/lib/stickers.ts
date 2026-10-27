import { useEffect, useState, useSyncExternalStore } from "react";
import { readZip, type ZipEntry } from "../import/zip";
import type { NoteKind } from "./types";

// Sticker packs, added in this browser from a ZIP file the user chooses, as Falcon Notes adds them on a device (its
// docs/04, Stickers; StickerPacks.cs, whose rules this ports). The app never downloads a pack. Packs are kept in this
// browser's IndexedDB, unencrypted, since they are not the user's writing; a sticker put on a note is uploaded as one
// of its files, so removing its pack leaves the note as it is. Packs are not in exports, and not on the server.

/** One sticker in a pack in this browser. */
export interface Sticker {
  packId: string;
  /** Its file in the pack, such as `007.png`. */
  file: string;
  /** What it shows: its description, and the name it gets on a note. */
  name: string;
  contentType: string;
}

/** A sticker pack added in this browser. */
export interface StickerPack {
  /** Lower-case letters, digits and dashes. A pack added again with the same ID replaces it. */
  id: string;
  name: string;
  author: string | null;
  licence: string | null;
  version: string | null;
  /** When it was added, in Unix milliseconds. */
  added: number;
  stickers: Sticker[];
}

/** A sticker pack that cannot be added, with the reason, for the user. */
export class StickerPackError extends Error {}

/** The file that describes a pack, inside its ZIP. Optional: without it every picture is a sticker. */
export const MANIFEST_NAME = "sticker-pack.json";
/** The most stickers a pack can have. */
export const MAX_STICKERS = 300;
/** The largest sticker: 2 MiB. */
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;
/** The largest ZIP file a pack can come in: 200 MiB. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 60;
const PACK_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Whether stickers are offered where a note of this kind is written: notes and quick notes, as with moods. */
export const stickersAllowed = (kind: NoteKind) => kind === "Note" || kind === "Quick";

/** "1 sticker", "12 stickers". */
export const stickerCount = (count: number) => (count === 1 ? "1 sticker" : `${count.toLocaleString()} stickers`);

/** The name a sticker gets on a note: "Waving cat.png". */
export const stickerFileName = (sticker: Sticker) => sticker.name + sticker.file.slice(sticker.file.lastIndexOf("."));

/** What a sticker on a note shows, from the name it was added with: "Waving cat.png" is "Waving cat". */
export function stickerName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// --- Reading a pack -------------------------------------------------------------------------------------------------

/** The picture's type from its first bytes, as its extension; null when it is none the app shows (SVG included). */
export function sniffPicture(bytes: Uint8Array): "png" | "jpg" | "gif" | "webp" | null {
  const at = (index: number, ...values: number[]) => values.includes(bytes[index] ?? -1);
  const ascii = (index: number, text: string) => [...text].every((c, i) => bytes[index + i] === c.charCodeAt(0));
  if (bytes.length >= 8 && at(0, 0x89) && ascii(1, "PNG") && at(4, 0x0d) && at(5, 0x0a) && at(6, 0x1a) && at(7, 0x0a)) return "png";
  if (bytes.length >= 3 && at(0, 0xff) && at(1, 0xd8) && at(2, 0xff)) return "jpg";
  if (bytes.length >= 6 && ascii(0, "GIF8") && at(4, 0x37, 0x39) && ascii(5, "a")) return "gif";
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

/** A name to show: trimmed, without control characters, at most 60 characters; null when nothing is left. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(/\p{Cc}/gu, "").trim();
  if (text.length > MAX_NAME_LENGTH) text = text.slice(0, MAX_NAME_LENGTH).trimEnd();
  return text.length === 0 ? null : text;
}

/** An ID made from a name: lower-case letters and digits, joined by dashes; null when nothing is left. */
export function packSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = "";
  for (const c of value.normalize("NFD").toLowerCase()) {
    if (/^[a-z0-9]$/.test(c)) text += c;
    else if (!/^\p{Mn}$/u.test(c) && text.length > 0 && !text.endsWith("-")) text += "-";
  }
  let slug = text.replace(/^-+|-+$/g, "");
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/, "");
  return slug.length === 0 ? null : slug;
}

/** Entries that are not part of a pack: macOS's resource forks and hidden files. */
const ignored = (path: string) => path.startsWith("__MACOSX/") || path.split("/").some((part) => part.startsWith("."));

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const withoutExtension = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);
const depth = (path: string) => path.split("/").length - 1;

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
}

/** A field of the manifest, as System.Text.Json's web defaults read it: by name, in any case. */
function field(object: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

interface Manifest {
  id?: unknown;
  name?: unknown;
  author?: unknown;
  licence?: unknown;
  version?: unknown;
  stickers: Array<{ file: string; name: unknown }> | null;
}

const optionalString = (value: unknown) => {
  if (value === undefined || value === null || typeof value === "string") return value ?? null;
  throw new Error("not a string");
};

async function readManifest(entry: ZipEntry): Promise<Manifest> {
  try {
    if (entry.size > MAX_MANIFEST_BYTES) throw new Error("too large");
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await entry.read()));
    if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("not an object");
    const object = json as Record<string, unknown>;
    const listed = field(object, "stickers");
    let stickers: Manifest["stickers"] = null;
    if (listed !== undefined && listed !== null) {
      if (!Array.isArray(listed)) throw new Error("stickers is not a list");
      stickers = listed.map((item: unknown) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("not a sticker");
        const sticker = item as Record<string, unknown>;
        return { file: (optionalString(field(sticker, "file")) as string | null) ?? "", name: optionalString(field(sticker, "name")) };
      });
    }
    return {
      id: optionalString(field(object, "id")),
      name: optionalString(field(object, "name")),
      author: optionalString(field(object, "author")),
      licence: optionalString(field(object, "licence")) ?? optionalString(field(object, "license")),
      version: optionalString(field(object, "version")),
      stickers,
    };
  } catch {
    throw new StickerPackError(`This sticker pack's ${MANIFEST_NAME} could not be read.`);
  }
}

/** A pack read from its ZIP file, with each sticker's picture, ready to be kept. */
export interface ReadPack {
  pack: StickerPack;
  pictures: Map<string, Uint8Array>;
}

/**
 * Reads a sticker pack from a ZIP file of pictures. The ZIP may hold a `sticker-pack.json`, at its top or in its one
 * top folder, that names the pack and lists its stickers; without one, every PNG, JPEG, GIF and WebP picture in it is a
 * sticker, in the order of their paths, and the pack is named after the file. Each picture's type is read from its
 * first bytes, and each is renamed `001.png`, `002.gif`…
 */
export async function readStickerPack(file: Blob, fileName: string, now = Date.now()): Promise<ReadPack> {
  if (file.size > MAX_ZIP_BYTES) throw new StickerPackError("This file is too large to be a sticker pack: a pack can be at most 200 MB.");
  let all: ZipEntry[];
  try {
    all = await readZip(file);
  } catch {
    throw new StickerPackError("This file is not a sticker pack. A sticker pack is a ZIP file of pictures.");
  }

  const entries = all.filter((entry) => !entry.name.endsWith("/") && !ignored(entry.name));
  const manifestEntry = entries
    .filter((entry) => baseName(entry.name).toLowerCase() === MANIFEST_NAME && depth(entry.name) <= 1)
    .sort((a, b) => depth(a.name) - depth(b.name))[0];
  const manifest = manifestEntry ? await readManifest(manifestEntry) : null;
  const folder = manifestEntry ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf("/") + 1) : "";

  let chosen: Array<{ entry: ZipEntry; name: unknown }>;
  if (manifest?.stickers) {
    const byPath = new Map<string, ZipEntry>();
    for (const entry of entries) if (!byPath.has(entry.name)) byPath.set(entry.name, entry);
    chosen = manifest.stickers.map((sticker) => {
      const entry = sticker.file.trim() ? byPath.get(folder + sticker.file.replace(/^\/+/, "")) : undefined;
      if (!entry) throw new StickerPackError(`This sticker pack lists "${sticker.file}", which is not in it.`);
      return { entry, name: sticker.name };
    });
  } else {
    chosen = entries
      .filter((entry) => extension(entry.name) in TYPES_BY_EXTENSION)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((entry) => ({ entry, name: null }));
  }

  if (chosen.length === 0) throw new StickerPackError("This sticker pack has no pictures in it.");
  if (chosen.length > MAX_STICKERS) {
    throw new StickerPackError(`A sticker pack can have at most ${MAX_STICKERS} stickers; this one has ${chosen.length.toLocaleString()}.`);
  }

  const packName = cleanName(manifest?.name) ?? cleanName(withoutExtension(baseName(fileName.replace(/\\/g, "/")))) ?? "Stickers";
  const id = packSlug(manifest?.id) ?? packSlug(packName) ?? "stickers";
  const stickers: Sticker[] = [];
  const pictures = new Map<string, Uint8Array>();
  for (const { entry, name } of chosen) {
    const shown = cleanName(name) ?? cleanName(withoutExtension(baseName(entry.name))) ?? "Sticker";
    if (entry.size > MAX_STICKER_BYTES) throw new StickerPackError(`"${shown}" is too large for a sticker: a sticker can be at most 2 MB.`);
    let bytes: Uint8Array;
    try {
      bytes = await entry.read();
    } catch (error) {
      throw new StickerPackError(error instanceof Error ? error.message : "This sticker pack is damaged.");
    }
    if (bytes.length > MAX_STICKER_BYTES) throw new StickerPackError(`"${shown}" is too large for a sticker: a sticker can be at most 2 MB.`);
    const kind = sniffPicture(bytes);
    if (!kind) throw new StickerPackError(`"${shown}" is not a PNG, JPEG, GIF or WebP picture, so it cannot be a sticker.`);
    const stored = `${String(stickers.length + 1).padStart(3, "0")}.${kind}`;
    pictures.set(stored, bytes);
    stickers.push({ packId: id, file: stored, name: shown, contentType: TYPES_BY_EXTENSION[kind]! });
  }

  return {
    pack: {
      id,
      name: packName,
      author: cleanName(manifest?.author),
      licence: cleanName(manifest?.licence),
      version: cleanName(manifest?.version),
      added: now,
      stickers,
    },
    pictures,
  };
}

// --- Keeping packs in this browser -----------------------------------------------------------------------------------

const DB_NAME = "maple-notes-stickers";
const PACKS = "packs";
const PICTURES = "pictures";

interface StoredPicture {
  packId: string;
  file: string;
  type: string;
  bytes: ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PACKS, { keyPath: "id" });
      request.result.createObjectStore(PICTURES, { keyPath: ["packId", "file"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  action: (packs: IDBObjectStore, pictures: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([PACKS, PICTURES], mode);
      const request = action(transaction.objectStore(PACKS), transaction.objectStore(PICTURES));
      transaction.oncomplete = () => resolve(request ? request.result : (undefined as T));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB request failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB request was aborted."));
    });
  } finally {
    db.close();
  }
}

const packPictures = (id: string) => IDBKeyRange.bound([id, ""], [id, "\uffff"]);

let cached: StickerPack[] | null = null;
let loading: Promise<StickerPack[]> | null = null;
const listeners = new Set<() => void>();

let version = 0;

function changed(): void {
  version++;
  cached = null;
  loading = null;
  listeners.forEach((listener) => listener());
}

const byName = (a: StickerPack, b: StickerPack) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "accent" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The packs in this browser, by name. */
export async function listStickerPacks(): Promise<StickerPack[]> {
  if (cached) return cached;
  loading ??= transact<StickerPack[]>("readonly", (packs) => packs.getAll()).then((all) => {
    const sorted = all.filter((pack) => PACK_ID.test(pack.id)).sort(byName);
    cached = sorted;
    return sorted;
  });
  return loading;
}

/**
 * Adds a pack from its ZIP file, replacing the pack with the same ID if there is one; returns it, and whether it
 * replaced one. The pack is written in one transaction, so it is there whole or not at all.
 */
export async function addStickerPack(file: Blob, fileName: string): Promise<{ pack: StickerPack; replaced: boolean }> {
  const { pack, pictures } = await readStickerPack(file, fileName);
  let replaced = false;
  await transact("readwrite", (packs, store) => {
    const existing = packs.getKey(pack.id);
    existing.onsuccess = () => {
      replaced = existing.result !== undefined;
      store.delete(packPictures(pack.id));
      for (const sticker of pack.stickers) {
        const bytes = pictures.get(sticker.file)!;
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        store.put({ packId: pack.id, file: sticker.file, type: sticker.contentType, bytes: copy } satisfies StoredPicture);
      }
      packs.put(pack);
    };
  });
  changed();
  return { pack, replaced };
}

/** Removes a pack from this browser. Stickers already on notes stay: they are the notes' own files. */
export async function removeStickerPack(id: string): Promise<void> {
  await transact("readwrite", (packs, pictures) => {
    pictures.delete(packPictures(id));
    packs.delete(id);
  });
  changed();
}

/** A sticker's picture, as a file named for a note; null when its pack was removed. */
export async function stickerFile(sticker: Sticker): Promise<File | null> {
  const stored = await transact<StoredPicture | undefined>("readonly", (_, pictures) => pictures.get([sticker.packId, sticker.file]));
  return stored ? new File([stored.bytes], stickerFileName(sticker), { type: stored.type }) : null;
}

/** The packs in this browser (null while they load), kept up to date as packs are added and removed. */
export function useStickerPacks(): StickerPack[] | null {
  const [packs, setPacks] = useState<StickerPack[] | null>(cached);
  const version = useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    let live = true;
    listStickerPacks()
      .then((list) => live && setPacks(list))
      .catch(() => live && setPacks([]));
    return () => {
      live = false;
    };
  }, [version]);
  return packs;
}

const getVersion = () => version;
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** An object URL for a sticker's picture in its pack, released when it is no longer shown. */
export function useStickerSrc(sticker: Sticker | undefined): string | undefined {
  const [src, setSrc] = useState<string>();
  const packId = sticker?.packId;
  const file = sticker?.file;
  useEffect(() => {
    if (!packId || !file) return;
    let url: string | undefined;
    let live = true;
    transact<StoredPicture | undefined>("readonly", (_, pictures) => pictures.get([packId, file]))
      .then((stored) => {
        if (!live || !stored) return;
        url = URL.createObjectURL(new Blob([stored.bytes], { type: stored.type }));
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setSrc(undefined);
    };
  }, [packId, file]);
  return src;
}
