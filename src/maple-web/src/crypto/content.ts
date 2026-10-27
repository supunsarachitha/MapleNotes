import type { DataKeys } from "./datakey";
import { fromUtf8, toBase64Url, utf8, uuidN, type Bytes } from "./encoding";
import { open, seal } from "./envelope";

// Note text, tag tokens and names, and attachment metadata (docs/e2ee-spec.md §2–§5).

export const noteContext = (userId: string, noteId: string) => `maple-notes/v2/e2ee/note/${uuidN(userId)}/${uuidN(noteId)}`;
export const tagContext = (userId: string, token: string) => `maple-notes/v2/e2ee/tag/${uuidN(userId)}/${token}`;
export const attachmentMetaContext = (userId: string, attachmentId: string) =>
  `maple-notes/v2/e2ee/attachment-meta/${uuidN(userId)}/${uuidN(attachmentId)}`;
export const labelContext = (userId: string, labelId: string) => `maple-notes/v2/e2ee/label/${uuidN(userId)}/${uuidN(labelId)}`;
export const modeContext = (userId: string) => `maple-notes/v2/e2ee/mode/${uuidN(userId)}`;
export const moodContext = (userId: string, noteId: string) => `maple-notes/v2/e2ee/mood/${uuidN(userId)}/${uuidN(noteId)}`;

export function encryptNote(keys: DataKeys, userId: string, noteId: string, text: string, nonce?: Uint8Array): Promise<Bytes> {
  return seal(keys.note, utf8(text), noteContext(userId, noteId), { keyVersion: keys.version, nonce });
}

export async function decryptNote(keys: DataKeys, userId: string, noteId: string, envelope: Uint8Array): Promise<string> {
  return fromUtf8(await open(keys.note, envelope, noteContext(userId, noteId)));
}

// ----------------------------------------------------------------------------------------------------------- moods

/** The moods as sealed, "none" included: every one is padded to the same length, so envelopes do not tell them apart. */
const MOOD_NAMES = ["none", "awful", "bad", "okay", "good", "great"] as const;
const MOOD_PADDING = 8;

/**
 * Encrypts a note's mood (docs/e2ee-spec.md §2a): its name in lower case, or "none", padded with spaces to 8 bytes,
 * under the metadata key and bound to the note.
 */
export function encryptMood(keys: DataKeys, userId: string, noteId: string, mood: string | null, nonce?: Uint8Array): Promise<Bytes> {
  const name = (mood ?? "none").toLowerCase();
  if (!(MOOD_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown mood: ${mood}`);
  return seal(keys.metadata, utf8(name.padEnd(MOOD_PADDING, " ")), moodContext(userId, noteId), { keyVersion: keys.version, nonce });
}

/** Opens a sealed mood: its name in lower case, or null for none. Throws when it is not a mood. */
export async function decryptMood(keys: DataKeys, userId: string, noteId: string, envelope: Uint8Array): Promise<string | null> {
  const name = fromUtf8(await open(keys.metadata, envelope, moodContext(userId, noteId))).trimEnd();
  if (!(MOOD_NAMES as readonly string[]).includes(name)) throw new Error("This is not a mood.");
  return name === "none" ? null : name;
}

// ------------------------------------------------------------------------------------------------------------ tags

// Same rules as the server's TagParser: a "#" not preceded by a word character, "/", "#" or "&", followed by a
// letter, digit or "_"; nested tags use "/". Code spans and fenced code blocks are ignored.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const TAG = /(?<![\p{L}\p{N}_/#&])#([\p{L}\p{N}_][\p{L}\p{N}_/-]{0,63})/gu;

/** Normalizes a tag name for tokens and display: NFC, lower case, no leading "#", no trailing "/" or "-". */
export function normalizeTag(name: string): string {
  return name.normalize("NFC").replace(/^#/, "").replace(/[/-]+$/, "").toLowerCase();
}

/** The distinct tags in a note, in order of appearance. */
export function extractTags(markdown: string): string[] {
  const text = markdown.replace(CODE, " ");
  const tags: string[] = [];
  for (const match of text.matchAll(TAG)) {
    const tag = normalizeTag(match[1]!);
    if (tag && !/^\d+$/.test(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Blind token for a tag: base64url(HMAC-SHA256(tagIndexKey, name)[0..16]). */
export async function tagToken(keys: DataKeys, name: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", keys.tagIndex, utf8(normalizeTag(name))));
  return toBase64Url(mac.subarray(0, 16));
}

export function encryptTagName(keys: DataKeys, userId: string, token: string, name: string, nonce?: Uint8Array): Promise<Bytes> {
  return seal(keys.metadata, utf8(normalizeTag(name)), tagContext(userId, token), { keyVersion: keys.version, nonce });
}

export async function decryptTagName(keys: DataKeys, userId: string, token: string, envelope: Uint8Array): Promise<string> {
  return fromUtf8(await open(keys.metadata, envelope, tagContext(userId, token)));
}

/** Tokens and encrypted names for every tag in a note, ready to send to the server. */
export async function encryptTags(keys: DataKeys, userId: string, markdown: string): Promise<Array<{ token: string; encryptedName: Bytes }>> {
  return Promise.all(
    extractTags(markdown).map(async (name) => {
      const token = await tagToken(keys, name);
      return { token, encryptedName: await encryptTagName(keys, userId, token, name) };
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------- labels

/** Encrypts a label's name, as written, for the label with this ID (docs/e2ee-spec.md §4a). */
export function encryptLabelName(keys: DataKeys, userId: string, labelId: string, name: string, nonce?: Uint8Array): Promise<Bytes> {
  return seal(keys.metadata, utf8(name), labelContext(userId, labelId), { keyVersion: keys.version, nonce });
}

export async function decryptLabelName(keys: DataKeys, userId: string, labelId: string, envelope: Uint8Array): Promise<string> {
  return fromUtf8(await open(keys.metadata, envelope, labelContext(userId, labelId)));
}

// ------------------------------------------------------------------------------------------------------ mode record

/** The account's mode as its owner chose it, and a counter that grows with every change (docs/e2ee-spec.md §3a). */
export interface ModeRecord {
  mode: "Off" | "AtRest" | "EndToEnd";
  epoch: number;
}

export function sealModeRecord(keys: DataKeys, userId: string, record: ModeRecord, nonce?: Uint8Array): Promise<Bytes> {
  return seal(keys.metadata, utf8(JSON.stringify({ mode: record.mode, epoch: record.epoch })), modeContext(userId), {
    keyVersion: keys.version,
    nonce,
  });
}

/** Opens a mode record; throws when it does not decrypt for this account or is not a mode record. */
export async function openModeRecord(keys: DataKeys, userId: string, envelope: Uint8Array): Promise<ModeRecord> {
  const parsed = JSON.parse(fromUtf8(await open(keys.metadata, envelope, modeContext(userId)))) as Partial<ModeRecord>;
  if (!(parsed.mode === "Off" || parsed.mode === "AtRest" || parsed.mode === "EndToEnd") || !Number.isSafeInteger(parsed.epoch)) {
    throw new Error("This is not a mode record.");
  }
  return { mode: parsed.mode, epoch: parsed.epoch! };
}

// ---------------------------------------------------------------------------------------------------- attachments

export interface AttachmentMetadata {
  name: string;
  type: string;
  size: number;
  /** A sticker from a sticker pack; written by every upload since 1.17 (as 0 or 1), absent in older metadata. */
  sticker?: boolean;
}

export function encryptMetadata(
  keys: DataKeys,
  userId: string,
  attachmentId: string,
  metadata: AttachmentMetadata | string,
  nonce?: Uint8Array,
): Promise<Bytes> {
  const json =
    typeof metadata === "string"
      ? metadata
      : JSON.stringify(
          metadata.sticker === undefined
            ? { name: metadata.name, type: metadata.type, size: metadata.size }
            : { name: metadata.name, type: metadata.type, size: metadata.size, sticker: metadata.sticker ? 1 : 0 },
        );
  return seal(keys.metadata, utf8(json), attachmentMetaContext(userId, attachmentId), { keyVersion: keys.version, nonce });
}

export async function decryptMetadata(keys: DataKeys, userId: string, attachmentId: string, envelope: Uint8Array): Promise<AttachmentMetadata> {
  const parsed = JSON.parse(fromUtf8(await open(keys.metadata, envelope, attachmentMetaContext(userId, attachmentId)))) as Record<string, unknown>;
  const metadata: AttachmentMetadata = { name: String(parsed.name), type: String(parsed.type), size: Number(parsed.size) };
  if (parsed.sticker !== undefined) metadata.sticker = parsed.sticker === 1;
  return metadata;
}
