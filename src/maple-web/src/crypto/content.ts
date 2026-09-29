import type { DataKeys } from "./datakey";
import { fromUtf8, toBase64Url, utf8, uuidN, type Bytes } from "./encoding";
import { open, seal } from "./envelope";

// Note text, tag tokens and names, and attachment metadata (docs/e2ee-spec.md §2–§5).

export const noteContext = (userId: string, noteId: string) => `maple-notes/v2/e2ee/note/${uuidN(userId)}/${uuidN(noteId)}`;
export const tagContext = (userId: string, token: string) => `maple-notes/v2/e2ee/tag/${uuidN(userId)}/${token}`;
export const attachmentMetaContext = (userId: string, attachmentId: string) =>
  `maple-notes/v2/e2ee/attachment-meta/${uuidN(userId)}/${uuidN(attachmentId)}`;

export function encryptNote(keys: DataKeys, userId: string, noteId: string, text: string, nonce?: Uint8Array): Promise<Bytes> {
  return seal(keys.note, utf8(text), noteContext(userId, noteId), { keyVersion: keys.version, nonce });
}

export async function decryptNote(keys: DataKeys, userId: string, noteId: string, envelope: Uint8Array): Promise<string> {
  return fromUtf8(await open(keys.note, envelope, noteContext(userId, noteId)));
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

// ---------------------------------------------------------------------------------------------------- attachments

export interface AttachmentMetadata {
  name: string;
  type: string;
  size: number;
}

export function encryptMetadata(
  keys: DataKeys,
  userId: string,
  attachmentId: string,
  metadata: AttachmentMetadata | string,
  nonce?: Uint8Array,
): Promise<Bytes> {
  const json = typeof metadata === "string" ? metadata : JSON.stringify({ name: metadata.name, type: metadata.type, size: metadata.size });
  return seal(keys.metadata, utf8(json), attachmentMetaContext(userId, attachmentId), { keyVersion: keys.version, nonce });
}

export async function decryptMetadata(keys: DataKeys, userId: string, attachmentId: string, envelope: Uint8Array): Promise<AttachmentMetadata> {
  const parsed = JSON.parse(fromUtf8(await open(keys.metadata, envelope, attachmentMetaContext(userId, attachmentId)))) as AttachmentMetadata;
  return { name: String(parsed.name), type: String(parsed.type), size: Number(parsed.size) };
}
