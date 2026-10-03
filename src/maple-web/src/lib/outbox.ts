import { useSyncExternalStore } from "react";
import { extractTags } from "../crypto/content";
import { uuidv7 } from "../crypto/encoding";
import { matchesSearch, openFromDevice, sealForDevice } from "./noteCrypto";
import type { Note, NoteKind, NotePage } from "./types";

// Writing offline (docs/architecture.md, "Writing offline"). When a new note or an edit cannot reach the server, and
// this device keeps notes for offline reading (a session started with "keep me signed in"), the change is kept here,
// in IndexedDB, and sent once the server answers again. Until then the note lists show it, marked as not saved yet.
//
// One entry per note: a note written offline ("create"), or new text for a note the server has ("update"), with the
// note's version as the server last sent it. Further edits replace the entry's text. An update is sent with that
// version, and the server refuses it if the note was edited elsewhere in the meantime; the text written here is then
// saved as a separate note rather than lost or written over the newer one. Text is encrypted for the note whenever
// this browser holds an end-to-end key (noteCrypto.ts, sealForDevice).

const DB_NAME = "maple-notes-outbox";
const STORE = "changes";

export interface OutboxEntry {
  noteId: string;
  userId: string;
  type: "create" | "update";
  kind: NoteKind;
  dailyDate: string | null;
  isPinned: boolean;
  createdAtUtc: string;
  /** When the text was last changed on this device. */
  changedAtUtc: string;
  /** For an update: the note's `updatedAtUtc` as the server last sent it, which the server checks. */
  baseUpdatedAtUtc: string | null;
  attachmentIds: string[];
  content: string | null;
  encryptedContent: string | null;
  /** Grows with every change, so a send that raced with a new edit does not drop that edit. */
  revision: number;
  /** The order changes were made in, which is the order they are sent in. */
  queuedAt: number;
}

/** Who may keep changes here: the signed-in account, when its session keeps notes on this device. */
interface Owner {
  userId: string;
  keepsNotes: boolean;
}

let owner: Owner | null = null;
let pendingCount = 0;
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "noteId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : (undefined as T));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB request failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB request was aborted."));
    });
  } finally {
    db.close();
  }
}

/** The signed-in account's changes, oldest first. */
export async function pendingChanges(): Promise<OutboxEntry[]> {
  if (!owner) return [];
  const userId = owner.userId;
  const all = await withStore<OutboxEntry[]>("readonly", (store) => store.getAll());
  return all.filter((entry) => entry.userId === userId).sort((a, b) => a.queuedAt - b.queuedAt);
}

async function refreshCount(): Promise<void> {
  const count = (await pendingChanges().catch(() => [])).length;
  if (count === pendingCount) return;
  pendingCount = count;
  changed();
}

async function getEntry(noteId: string): Promise<OutboxEntry | undefined> {
  const entry = await withStore<OutboxEntry | undefined>("readonly", (store) => store.get(noteId));
  return entry && entry.userId === owner?.userId ? entry : undefined;
}

async function putEntry(entry: OutboxEntry): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
  await refreshCount();
}

async function deleteEntry(noteId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(noteId));
  await refreshCount();
}

/**
 * Called by the app with the signed-in account (null when signed out). Another account's changes are deleted: they
 * could not be sent for it, and nothing of one account stays behind for the next, as with offline reading.
 */
export function setOutboxOwner(next: Owner | null): void {
  const previous = owner;
  owner = next;
  if (!next || (previous?.userId === next.userId && previous.keepsNotes === next.keepsNotes)) return;
  void withStore<OutboxEntry[]>("readonly", (store) => store.getAll())
    .then(async (all) => {
      for (const entry of all) if (entry.userId !== next.userId) await withStore("readwrite", (store) => store.delete(entry.noteId));
    })
    .catch(() => undefined)
    .finally(() => void refreshCount());
}

/** Deletes every change kept on this device (signing out, deleting the account or all of its content). */
export async function forgetPendingChanges(): Promise<void> {
  await withStore("readwrite", (store) => store.clear()).catch(() => undefined);
  await refreshCount();
}

/** Whether a failed save may be kept here: the server could not be reached, and this device keeps notes. */
export function canKeepOffline(status: number): boolean {
  // 0: no answer at all; 502–504: a proxy answered for a server that did not.
  return owner?.keepsNotes === true && (status === 0 || status === 502 || status === 503 || status === 504);
}

/** Whether this note has a change waiting here; its saves then go here too, so they reach the server in order. */
export async function hasPendingChange(noteId: string): Promise<boolean> {
  return owner !== null && (await getEntry(noteId).catch(() => undefined)) !== undefined;
}

const nowUtc = () => new Date().toISOString();

function asNote(entry: OutboxEntry, content: string, base?: Note): Note {
  return {
    ...(base ?? { labelIds: [], isArchived: false, trashedAtUtc: null }),
    id: entry.noteId,
    kind: entry.kind,
    dailyDate: entry.dailyDate,
    isPinned: base?.isPinned ?? entry.isPinned,
    createdAtUtc: base?.createdAtUtc ?? entry.createdAtUtc,
    // When it changed here: views that keep their own copy of the text (lib/noteEditor.ts) take a newer version only.
    updatedAtUtc: entry.changedAtUtc,
    content,
    tags: extractTags(content).sort(),
    attachments: base?.attachments ?? [],
    pending: true,
  };
}

/** Keeps a new note written offline; it gets its ID here, which it keeps on the server. */
export async function keepNewNote(
  content: string,
  attachmentIds: string[],
  options: { isPinned?: boolean; kind?: NoteKind; dailyDate?: string },
): Promise<Note> {
  if (!owner) throw new Error("Not signed in.");
  const noteId = uuidv7();
  const now = nowUtc();
  const entry: OutboxEntry = {
    noteId,
    userId: owner.userId,
    type: "create",
    kind: options.kind ?? "Note",
    dailyDate: options.dailyDate ?? null,
    isPinned: options.isPinned ?? false,
    createdAtUtc: now,
    changedAtUtc: now,
    baseUpdatedAtUtc: null,
    attachmentIds,
    ...(await sealForDevice(noteId, content)),
    revision: 1,
    queuedAt: Date.now(),
  };
  await putEntry(entry);
  return asNote(entry, content);
}

/** Keeps new text for a note: one written offline, or one the server has, as `seen` showed it. */
export async function keepEdit(seen: Note, content: string, attachmentIds: string[]): Promise<Note> {
  if (!owner) throw new Error("Not signed in.");
  const existing = await getEntry(seen.id);
  const entry: OutboxEntry = existing ?? {
    noteId: seen.id,
    userId: owner.userId,
    type: "update",
    kind: seen.kind,
    dailyDate: seen.dailyDate ?? null,
    isPinned: seen.isPinned,
    createdAtUtc: seen.createdAtUtc,
    changedAtUtc: "",
    baseUpdatedAtUtc: seen.updatedAtUtc,
    attachmentIds: [],
    content: null,
    encryptedContent: null,
    revision: 0,
    queuedAt: Date.now(),
  };
  const next: OutboxEntry = {
    ...entry,
    changedAtUtc: nowUtc(),
    attachmentIds,
    ...(await sealForDevice(seen.id, content)),
    revision: entry.revision + 1,
  };
  await putEntry(next);
  return asNote(next, content, seen);
}

/** Shows the changes kept here in a page of notes from the server (or from the copies offline reading saved). */
export async function withPendingChanges(
  page: NotePage,
  filter: { state: string; kinds: NoteKind[]; firstPage: boolean; tag?: string; label?: string; q?: string; createdFrom?: string; createdBefore?: string },
): Promise<NotePage> {
  const entries = await pendingChanges().catch(() => []);
  if (entries.length === 0) return page;
  const byId = new Map(entries.map((entry) => [entry.noteId, entry]));
  const items = await Promise.all(
    page.items.map(async (note) => {
      const entry = byId.get(note.id);
      if (!entry) return note;
      byId.delete(note.id);
      const content = await openFromDevice(note.id, entry).catch(() => null);
      return content === null ? note : asNote(entry, content, note);
    }),
  );
  if (!filter.firstPage || !["active", "feed", "pinned"].includes(filter.state) || filter.label) return { ...page, items };

  // New notes written here belong at the top of the first page of the lists they would appear in.
  const added: Note[] = [];
  for (const entry of byId.values()) {
    if (entry.type !== "create" || !filter.kinds.includes(entry.kind)) continue;
    if ((filter.state === "feed" && entry.isPinned) || (filter.state === "pinned" && !entry.isPinned)) continue;
    if (filter.createdFrom && entry.createdAtUtc < new Date(filter.createdFrom).toISOString()) continue;
    if (filter.createdBefore && entry.createdAtUtc >= new Date(filter.createdBefore).toISOString()) continue;
    const content = await openFromDevice(entry.noteId, entry).catch(() => null);
    if (content === null) continue;
    const note = asNote(entry, content);
    if (filter.q && !matchesSearch(note, filter.q)) continue;
    if (filter.tag && !note.tags.some((tag) => tag === filter.tag!.toLowerCase() || tag.startsWith(`${filter.tag!.toLowerCase()}/`))) continue;
    added.push(note);
  }
  added.sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1));
  return { ...page, items: [...added, ...items] };
}

/** A day's daily note written offline and not sent yet, if there is one. */
export async function pendingDailyNote(date: string): Promise<Note | null> {
  const entry = (await pendingChanges().catch(() => [])).find((change) => change.type === "create" && change.dailyDate === date);
  if (!entry) return null;
  const content = await openFromDevice(entry.noteId, entry).catch(() => null);
  return content === null ? null : asNote(entry, content);
}

/** What sending a change needs from the API client (lib/api.ts), kept apart so tests can drive it. */
export interface Sender {
  /** Creates the note with its ID and dates, or finds that the server already has it; returns the server's note. */
  create(entry: OutboxEntry, content: string): Promise<Note>;
  /** Replaces the text if the note is still at `entry.baseUpdatedAtUtc`; returns the server's note. */
  update(entry: OutboxEntry, content: string): Promise<Note>;
  /** The note as the server has it now, or null when it is gone. */
  current(noteId: string): Promise<Note | null>;
  /** Saves text as a separate new note, when the note it was written for changed or went away meanwhile. */
  saveCopy(entry: OutboxEntry, content: string): Promise<void>;
}

export type SyncResult = { sent: number; copies: number; failed: string[]; stopped: boolean };

/** How an error from the server is handled while sending: try later, keep both versions, or give up on the change. */
function outcome(error: unknown, type: OutboxEntry["type"]): "later" | "copy" | "drop" {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return "later";
  // Not reached, a server error, a full account (room may be made), or a session that must be signed in again.
  if (status === 0 || status >= 500 || status === 401 || status === 403) return "later";
  if (type === "update" && (status === 409 || status === 404)) return "copy";
  return "drop";
}

let running: Promise<SyncResult> | null = null;

/** Sends the kept changes in the order they were made; one run at a time. */
export function sendPendingChanges(sender: Sender): Promise<SyncResult> {
  running ??= send(sender).finally(() => {
    running = null;
  });
  return running;
}

async function send(sender: Sender): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, copies: 0, failed: [], stopped: false };
  for (const entry of await pendingChanges()) {
    let content: string;
    try {
      content = await openFromDevice(entry.noteId, entry);
    } catch {
      continue; // not readable in this browser now (locked); it stays for later
    }
    let saved: Note | null = null;
    try {
      saved = entry.type === "create" ? await sender.create(entry, content) : await sender.update(entry, content);
    } catch (error) {
      const next = outcome(error, entry.type);
      if (next === "later") {
        result.stopped = true;
        break;
      }
      try {
        if (next === "copy") {
          // A refusal can also follow our own save whose answer was lost: then the server already has this text.
          const current = await sender.current(entry.noteId);
          if (current?.content !== content) {
            await sender.saveCopy(entry, content);
            result.copies++;
          }
        } else {
          result.failed.push(error instanceof Error ? error.message : String(error));
        }
      } catch (copyError) {
        if (outcome(copyError, "create") === "later") {
          result.stopped = true;
          break;
        }
        result.failed.push(copyError instanceof Error ? copyError.message : String(copyError));
      }
    }

    // Edited again while it was on its way: keep the newer text, as an edit of the version just saved.
    const now = await getEntry(entry.noteId);
    if (now && now.revision !== entry.revision && saved) {
      await putEntry({ ...now, type: "update", baseUpdatedAtUtc: saved.updatedAtUtc, noteId: saved.id });
      if (saved.id !== entry.noteId) await deleteEntry(entry.noteId);
    } else if (now && now.revision === entry.revision) {
      await deleteEntry(entry.noteId);
    }
    if (saved) result.sent++;
  }
  return result;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How many notes have changes on this device that the server does not have yet. */
export function usePendingCount(): number {
  return useSyncExternalStore(subscribe, () => pendingCount, () => 0);
}
