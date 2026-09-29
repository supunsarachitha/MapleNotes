import { decryptNote, decryptTagName, encryptNote, encryptTags, extractTags, normalizeTag, tagToken } from "../crypto/content";
import type { DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64, uuidv7 } from "../crypto/encoding";
import { ApiError } from "./apiError";
import type { EncryptedNoteWire, EncryptionMode, Note, NoteWire, Tag, TagWire } from "./types";

// End-to-end encryption of notes and tags at the API boundary (docs/e2ee-spec.md §2, §4). Components always work with
// plain notes: api.ts passes what it sends and receives through here, and this module encrypts, decrypts and turns tag
// filters into blind tokens according to the signed-in account's mode and unlocked key.

/** Shown in place of a note that cannot be decrypted in this browser. */
export const UNREADABLE_NOTE = "⚠️ This note could not be decrypted. It may be damaged, or it was encrypted with another key.";

interface ContentSession {
  userId: string;
  mode: EncryptionMode;
  /** The unlocked end-to-end key, or null for an account without one. */
  keys: DataKeys | null;
}

let session: ContentSession | null = null;
// From the last tag list: every tag name (decrypted where needed), to expand a filter to the nested tags below it, and
// the names the server itself knows, i.e. those of plain-text notes.
let knownTags: string[] | null = null;
let plainTags = new Set<string>();

/** Called by the app shell with the signed-in account and its unlocked key (null when signed out). */
export function setContentSession(next: ContentSession | null): void {
  if (next?.userId !== session?.userId) {
    knownTags = null;
    plainTags = new Set();
  }
  session = next;
}

/** Whether a tag filter needs the tag list first, to find the nested tags below the filtered one. */
export function needsTagList(): boolean {
  return session?.keys != null && knownTags === null;
}

/** Whether this browser reads end-to-end content, and must therefore also search and filter tags itself. */
export function readsEndToEnd(): boolean {
  return session?.keys != null;
}

function unlocked(): { userId: string; keys: DataKeys } {
  if (!session?.keys) throw new ApiError(0, { title: "Unlock your notes first." });
  return { userId: session.userId, keys: session.keys };
}

async function encryptForNote(noteId: string, content: string): Promise<EncryptedNoteWire> {
  const { userId, keys } = unlocked();
  const [envelope, tags] = await Promise.all([encryptNote(keys, userId, noteId, content), encryptTags(keys, userId, content)]);
  return { content: toBase64(envelope), tags: tags.map((tag) => ({ token: tag.token, name: toBase64(tag.encryptedName) })) };
}

/** Request fields for a new note: plain text, or an ID chosen here with the encrypted text and tags. */
export async function encodeNewNote(content: string): Promise<{ content?: string; id?: string; encrypted?: EncryptedNoteWire }> {
  if (session?.mode !== "EndToEnd") return { content };
  const id = uuidv7();
  return { id, encrypted: await encryptForNote(id, content) };
}

/** Request fields for new text of an existing note. Saving any note in end-to-end mode also converts it. */
export async function encodeNoteUpdate(id: string, content: string): Promise<{ content?: string; encrypted?: EncryptedNoteWire }> {
  return session?.mode === "EndToEnd" ? { encrypted: await encryptForNote(id, content) } : { content };
}

/** A note as components see it: decrypted, with its tags read from the text. */
export async function decodeNote(note: NoteWire): Promise<Note> {
  const { encryptedContent, ...rest } = note;
  if (!encryptedContent) return { ...rest, content: note.content ?? "" };
  try {
    const { userId, keys } = unlocked();
    const content = await decryptNote(keys, userId, note.id, fromBase64(encryptedContent));
    return { ...rest, content, tags: extractTags(content).sort() };
  } catch {
    return { ...rest, content: UNREADABLE_NOTE, tags: [] };
  }
}

/**
 * The tag list with end-to-end tags decrypted. A tag used by both plain and end-to-end notes (while an account
 * converts) appears once, with the counts added up.
 */
export async function decodeTags(tags: TagWire[]): Promise<Tag[]> {
  const counts = new Map<string, number>();
  plainTags = new Set(tags.flatMap((tag) => (tag.name ? [tag.name] : [])));
  for (const tag of tags) {
    let name = tag.name;
    if (!name && tag.token && tag.encryptedName && session?.keys) {
      name = await decryptTagName(session.keys, session.userId, tag.token, fromBase64(tag.encryptedName)).catch(() => null);
    }
    if (name) counts.set(name, (counts.get(name) ?? 0) + tag.noteCount);
  }
  const decoded = [...counts].map(([name, noteCount]) => ({ name, noteCount })).sort((a, b) => (a.name < b.name ? -1 : 1));
  knownTags = decoded.map((tag) => tag.name);
  return decoded;
}


/**
 * Filter parameters for a tag. For end-to-end notes: the tokens of the tag and of every nested tag known below it
 * (the server cannot see that `work/meetings` is below `work`). The name itself is sent only when plain-text notes
 * carry the tag (while an account converts), so the server never learns a name it does not already know.
 */
export async function tagFilterParams(tag: string): Promise<{ tag?: string; tagToken?: string[] }> {
  if (!session?.keys) return { tag };
  const keys = session.keys;
  const name = normalizeTag(tag);
  const below = (known: string) => known === name || known.startsWith(`${name}/`);
  const names = [name, ...(knownTags ?? []).filter((known) => known !== name && below(known))];
  const tokens = await Promise.all(names.map((known) => tagToken(keys, known)));
  return [...plainTags].some(below) ? { tag, tagToken: tokens } : { tagToken: tokens };
}

/** Whether a decrypted note matches a search, as the server's search does: text or attachment names, any case. */
export function matchesSearch(note: Note, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return note.content.toLowerCase().includes(needle) || note.attachments.some((a) => a.fileName.toLowerCase().includes(needle));
}
