import { useQuery } from "@tanstack/react-query";
import { extractTags } from "../crypto/content";
import { uuidv7 } from "../crypto/encoding";
import { ApiError } from "./apiError";
import {
  LABEL_COLORS,
  type AuthStatus,
    type EncryptionStatus,
  type LabelColor,
  type LabelWire,
  type NoteKind,
  type NotePageWire,
  type NoteState,
  type NoteWire,
  type Preferences,
  type StorageUsage,
  type TagWire,
  type User,
} from "./types";

// Notebooks on the device (docs/architecture.md, "Notebooks on the device"). Where an administrator allows it, the
// installed app can keep notes in a database in this browser instead of in an account on the server, and then works
// with no server at all. While the notebook is open, lib/api.ts hands every API request to `deviceRequest` here, which
// answers it from IndexedDB the way the server would (Features/Notes/NoteService.cs, Features/Labels/LabelService.cs),
// so the rest of the app works unchanged. Nothing is sent to the server, and nothing syncs: the notes exist only here,
// so exporting them is the way to back them up or move them to an account. Files are not kept.

const DB_NAME = "maple-notes-device";
const META = "meta";
const NOTES = "notes";
const LABELS = "labels";
const META_KEY = "notebook";

/** The limits the server applies to accounts, kept the same so a notebook's export restores into an account. */
const MAX_CONTENT_LENGTH = 100_000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_LABELS = 100;
const MAX_LABELS_PER_NOTE = 20;
const MAX_LABEL_NAME = 40;
const MAX_IMPORT_IDS = 500;
const MAX_DISPLAY_NAME = 64;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ALL_KINDS: NoteKind[] = ["Note", "Todo", "Quick", "Habit"];

/** The notebook itself: its name and preferences, and whether the app shows it rather than the server's sign-in. */
interface NotebookMeta {
  id: string;
  displayName: string;
  createdAtUtc: string;
  preferences: Preferences;
  /** The app's name as the server last gave it, shown while the notebook is open. */
  appName: string;
  open: boolean;
}

interface StoredNote {
  id: string;
  kind: NoteKind;
  dailyDate: string | null;
  content: string;
  isPinned: boolean;
  archivedAtUtc: string | null;
  trashedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  tags: string[];
  labelIds: string[];
}

interface StoredLabel {
  id: string;
  name: string;
  color: LabelColor;
  createdAtUtc: string;
}

/** What the sign-in page shows of a notebook kept on this device. */
export interface NotebookSummary {
  displayName: string;
  createdAtUtc: string;
  open: boolean;
}

// ---- IndexedDB ----

let connection: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(META);
      request.result.createObjectStore(NOTES, { keyPath: "id" });
      request.result.createObjectStore(LABELS, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error ?? new Error("IndexedDB is unavailable."));
    };
  });
  return connection;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB request failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB request was aborted."));
  });
}

async function readAll<T>(store: string): Promise<T[]> {
  const transaction = (await database()).transaction(store, "readonly");
  const request = transaction.objectStore(store).getAll();
  await done(transaction);
  return request.result as T[];
}

async function readMeta(): Promise<NotebookMeta | null> {
  const transaction = (await database()).transaction(META, "readonly");
  const request = transaction.objectStore(META).get(META_KEY);
  await done(transaction);
  return (request.result as NotebookMeta | undefined) ?? null;
}

/** Writes and deletes in one transaction, so a change is saved whole or not at all. */
async function write(changes: { meta?: NotebookMeta; notes?: StoredNote[]; deleteNotes?: string[]; labels?: StoredLabel[]; deleteLabels?: string[] }): Promise<void> {
  const transaction = (await database()).transaction([META, NOTES, LABELS], "readwrite");
  if (changes.meta) transaction.objectStore(META).put(changes.meta, META_KEY);
  for (const note of changes.notes ?? []) transaction.objectStore(NOTES).put(note);
  for (const id of changes.deleteNotes ?? []) transaction.objectStore(NOTES).delete(id);
  for (const label of changes.labels ?? []) transaction.objectStore(LABELS).put(label);
  for (const id of changes.deleteLabels ?? []) transaction.objectStore(LABELS).delete(id);
  await done(transaction);
}

// ---- The notebook ----

// Whether the notebook is open, read once and then kept here: every API request asks.
let openState: boolean | null = null;

/** Whether the app shows the notebook on this device instead of the server's account. False where there is no IndexedDB. */
export async function isNotebookOpen(): Promise<boolean> {
  if (openState === null) {
    try {
      openState = typeof indexedDB !== "undefined" && (await readMeta())?.open === true;
    } catch {
      openState = false;
    }
  }
  return openState;
}

/** The notebook kept on this device, or null when there is none. */
export async function notebookOnDevice(): Promise<NotebookSummary | null> {
  if (typeof indexedDB === "undefined") return null;
  const meta = await readMeta().catch(() => null);
  return meta && { displayName: meta.displayName, createdAtUtc: meta.createdAtUtc, open: meta.open };
}

/** The notebook on this device, for the sign-in screens. */
export function useNotebookOnDevice() {
  return useQuery({ queryKey: ["device-notebook"], queryFn: notebookOnDevice, staleTime: Infinity });
}

/** Creates the notebook and opens it. There is at most one per device (per browser profile). */
export async function createNotebook(options: { displayName: string; appName: string; preferences: Preferences }): Promise<void> {
  if (await readMeta()) throw new Error("This device already has a notebook.");
  const displayName = options.displayName.trim().slice(0, MAX_DISPLAY_NAME) || "My notebook";
  await write({
    meta: { id: uuidv7(), displayName, createdAtUtc: new Date().toISOString(), preferences: options.preferences, appName: options.appName, open: true },
  });
  openState = true;
  // Ask the browser not to clear the notebook to make room: its notes exist nowhere else. Installed apps usually get this.
  await navigator.storage?.persist?.().catch(() => false);
}

/** Shows the notebook instead of the server's sign-in, remembering the app's name as the server last gave it. */
export async function openNotebook(appName?: string): Promise<void> {
  const meta = await readMeta();
  if (!meta) throw new Error("This device has no notebook.");
  await write({ meta: { ...meta, open: true, appName: appName ?? meta.appName } });
  openState = true;
}

/** Goes back to the server's sign-in; the notebook stays on the device. */
export async function closeNotebook(): Promise<void> {
  const meta = await readMeta();
  if (meta) await write({ meta: { ...meta, open: false } });
  openState = false;
}

/** Deletes the notebook and every note in it, for good. */
export async function deleteNotebook(): Promise<void> {
  const db = await connection?.catch(() => null);
  db?.close();
  connection = null;
  openState = false;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The notebook could not be deleted."));
    request.onblocked = () => resolve(); // another window still has it open; it is deleted once that one closes it
  });
}

/** Whether the app runs installed (added to the home screen or the desktop) rather than in a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true; // Safari on iOS
  return (
    standalone ||
    ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true,
    )
  );
}

// ---- The API, answered on the device ----

function notFound(): ApiError {
  return new ApiError(404, { title: "Not found." });
}

function invalid(field: string, message: string): ApiError {
  return new ApiError(400, { title: message, errors: { [field]: [message] } });
}

function notAvailable(): ApiError {
  return new ApiError(404, { title: "This is not available in a notebook kept on this device." });
}

function toUser(meta: NotebookMeta): User {
  return {
    id: meta.id,
    username: "",
    displayName: meta.displayName,
    role: "User",
    encryptionMode: "Off",
    hasEndToEndKey: false,
    createdAtUtc: meta.createdAtUtc,
    preferences: meta.preferences,
  };
}

function toWire(note: StoredNote): NoteWire {
  return {
    id: note.id,
    kind: note.kind,
    dailyDate: note.dailyDate,
    content: note.content,
    encryptedContent: null,
    isPinned: note.isPinned,
    isArchived: note.archivedAtUtc !== null,
    createdAtUtc: note.createdAtUtc,
    updatedAtUtc: note.updatedAtUtc,
    tags: [...note.tags].sort(compareOrdinal),
    attachments: [],
    labelIds: [...note.labelIds].sort(compareOrdinal),
    trashedAtUtc: note.trashedAtUtc,
  };
}

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const time = (iso: string) => Date.parse(iso);
const isActive = (note: StoredNote) => note.archivedAtUtc === null && note.trashedAtUtc === null;

function kindsOf(params: URLSearchParams): NoteKind[] | null {
  const kinds = params.getAll("kind");
  if (kinds.length === 0) return null;
  if (!kinds.every((kind) => (ALL_KINDS as string[]).includes(kind))) throw invalid("kind", "The kind must be Note, Todo, Quick or Habit.");
  return [...new Set(kinds)] as NoteKind[];
}

/** Notes counted for tags, labels and the calendar: active ones of these kinds, or of every kind but habits. */
function counted(notes: StoredNote[], kinds: NoteKind[] | null): StoredNote[] {
  return notes.filter((note) => isActive(note) && (kinds ? kinds.includes(note.kind) : note.kind !== "Habit"));
}

function validateContent(content: unknown): string {
  const text = typeof content === "string" ? content : "";
  if (text.length > MAX_CONTENT_LENGTH) throw invalid("content", `A note can be at most ${MAX_CONTENT_LENGTH.toLocaleString("en")} characters long.`);
  if (!text.trim()) throw invalid("content", "Write something.");
  return text;
}

function validateKind(kind: unknown): NoteKind {
  if (kind === undefined || kind === null) return "Note";
  if (!(ALL_KINDS as unknown[]).includes(kind)) throw invalid("kind", "The kind must be Note, Todo, Quick or Habit.");
  return kind as NoteKind;
}

function noFiles(attachmentIds: unknown): void {
  if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
    throw invalid("attachmentIds", "A notebook kept on this device cannot hold files.");
  }
}

function dailyNoteExists(): ApiError {
  return new ApiError(409, { title: "This day already has a daily note." });
}

/** Position in a list: the sort time and ID of the last note shown (as NoteCursor.cs on the server). */
function encodeCursor(at: string, id: string): string {
  return btoa(`${time(at)}.${id}`);
}

function decodeCursor(cursor: string): { at: number; id: string } {
  try {
    const [at, id] = atob(cursor).split(".");
    if (at && id && /^\d+$/.test(at)) return { at: Number(at), id };
  } catch {
    // not base64: the error below
  }
  throw invalid("cursor", "The cursor is not valid. Start again from the first page.");
}

function listNotes(all: StoredNote[], params: URLSearchParams): NotePageWire {
  const state = (params.get("state") ?? "feed") as NoteState;
  const kinds = kindsOf(params) ?? ["Note"];
  const limit = Math.min(Math.max(Number(params.get("limit") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const tag = params.get("tag")?.trim().replace(/^#/, "").toLowerCase() || null;
  const label = params.get("label");
  const search = params.get("q")?.trim().toLowerCase() || null;
  const from = params.get("createdFrom");
  const before = params.get("createdBefore");
  const cursor = params.get("cursor");

  const inState: Record<NoteState, (note: StoredNote) => boolean> = {
    feed: (note) => !note.isPinned && isActive(note),
    pinned: (note) => note.isPinned && isActive(note),
    active: isActive,
    archived: (note) => note.archivedAtUtc !== null && note.trashedAtUtc === null,
    trash: (note) => note.trashedAtUtc !== null,
  };
  if (!(state in inState)) throw invalid("state", "The state must be feed, pinned, active, archived or trash.");
  const sortTime = (note: StoredNote) => (state === "trash" ? (note.trashedAtUtc ?? note.createdAtUtc) : note.createdAtUtc);

  let notes = all.filter(
    (note) =>
      kinds.includes(note.kind) &&
      inState[state](note) &&
      (!from || time(note.createdAtUtc) >= time(from)) &&
      (!before || time(note.createdAtUtc) < time(before)) &&
      (!tag || note.tags.some((name) => name === tag || name.startsWith(`${tag}/`))) &&
      (!label || note.labelIds.includes(label)) &&
      (!search || note.content.toLowerCase().includes(search)),
  );
  notes.sort((a, b) => time(sortTime(b)) - time(sortTime(a)) || compareOrdinal(b.id, a.id));
  if (cursor) {
    const position = decodeCursor(cursor);
    notes = notes.filter((note) => time(sortTime(note)) < position.at || (time(sortTime(note)) === position.at && note.id < position.id));
  }
  const page = notes.slice(0, limit);
  const last = page[limit - 1];
  return { items: page.map(toWire), nextCursor: notes.length > limit && last ? encodeCursor(sortTime(last), last.id) : null };
}

/** The local day (yyyy-MM-dd) of an instant in a time zone. */
function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function calendar(all: StoredNote[], params: URLSearchParams): Array<{ date: string; count: number }> {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const timeZone = params.get("timeZone") || "UTC";
  try {
    dayIn(new Date().toISOString(), timeZone);
  } catch {
    throw invalid("timeZone", `Unknown time zone '${timeZone}'. Use an IANA name such as Europe/Paris.`);
  }
  const counts = new Map<string, number>();
  for (const note of counted(all, kindsOf(params))) {
    const day = dayIn(note.createdAtUtc, timeZone);
    if (day >= from && day <= to) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => compareOrdinal(a, b)).map(([date, count]) => ({ date, count }));
}

function listTags(all: StoredNote[], params: URLSearchParams): TagWire[] {
  const counts = new Map<string, number>();
  for (const note of counted(all, kindsOf(params))) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => compareOrdinal(a, b)).map(([name, noteCount]) => ({ name, noteCount }));
}

function listLabels(labels: StoredLabel[], all: StoredNote[], kinds: NoteKind[] | null): LabelWire[] {
  const notes = counted(all, kinds);
  return [...labels]
    .sort((a, b) => time(a.createdAtUtc) - time(b.createdAtUtc) || compareOrdinal(a.id, b.id))
    .map((label) => ({
      id: label.id,
      name: label.name,
      encryptedName: null,
      color: label.color,
      noteCount: notes.filter((note) => note.labelIds.includes(label.id)).length,
    }));
}

function labelName(name: unknown): string {
  const clean = typeof name === "string" ? name.trim() : "";
  if (clean.length === 0 || clean.length > MAX_LABEL_NAME) throw invalid("name", `A label's name is 1 to ${MAX_LABEL_NAME} characters long.`);
  return clean;
}

function labelColor(color: unknown): LabelColor {
  const match = LABEL_COLORS.find((c) => typeof color === "string" && c.toLowerCase() === color.toLowerCase());
  if (!match) throw invalid("color", `Choose one of: ${LABEL_COLORS.join(", ")}.`);
  return match;
}

function checkLabels(labelIds: unknown, labels: StoredLabel[]): string[] {
  const ids = [...new Set(Array.isArray(labelIds) ? (labelIds as string[]) : [])];
  if (ids.length > MAX_LABELS_PER_NOTE) throw invalid("labelIds", `A note can have at most ${MAX_LABELS_PER_NOTE} labels.`);
  if (!ids.every((id) => labels.some((label) => label.id === id))) throw invalid("labelIds", "One or more labels do not exist.");
  return ids;
}

type Body = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Notes left in the trash for 30 days are deleted for good, as on the server. */
async function purgeExpiredTrash(notes: StoredNote[], now: number): Promise<void> {
  const expired = notes.filter((note) => note.trashedAtUtc !== null && time(note.trashedAtUtc) < now - TRASH_RETENTION_MS);
  if (expired.length > 0) await write({ deleteNotes: expired.map((note) => note.id) });
}

async function route(method: string, path: string, body: Body): Promise<unknown> {
  const url = new URL(path, "http://device");
  const params = url.searchParams;
  // "PUT notes/0192…" becomes "PUT notes/:id", "GET notes/daily/2026-10-03" becomes "GET notes/daily/:date".
  const segments = url.pathname.replace(/^\/api\/v1\//, "").split("/");
  const id = segments.find((segment) => UUID.test(segment));
  const date = segments.find((segment) => DATE.test(segment));
  const call = `${method} ${segments.map((segment) => (UUID.test(segment) ? ":id" : DATE.test(segment) ? ":date" : segment)).join("/")}`;
  const meta = await readMeta();
  if (!meta) throw new ApiError(401, { title: "This device has no notebook." });
  const now = new Date();
  const nowIso = now.toISOString();

  switch (call) {
    case "GET auth/status": {
      await purgeExpiredTrash(await readAll<StoredNote>(NOTES), now.getTime());
      return {
        setupRequired: false,
        registrationOpen: false,
        user: toUser(meta),
        linkPreviewsAvailable: false,
        branding: { appName: meta.appName, iconUrl: null },
        version: null,
        sessionPersistent: false,
        onDevice: true,
      } satisfies AuthStatus;
    }
    case "GET notes":
      return listNotes(await readAll<StoredNote>(NOTES), params);
    case "GET notes/calendar":
      return calendar(await readAll<StoredNote>(NOTES), params);
    case "GET notes/daily/:date": {
      const note = (await readAll<StoredNote>(NOTES)).find((n) => n.dailyDate === date);
      if (!note) throw notFound();
      return toWire(note);
    }
    case "GET notes/:id": {
      const note = (await readAll<StoredNote>(NOTES)).find((n) => n.id === id);
      if (!note) throw notFound();
      return toWire(note);
    }
    case "POST notes": {
      noFiles(body.attachmentIds);
      const kind = validateKind(body.kind);
      const content = validateContent(body.content);
      const dailyDate = typeof body.dailyDate === "string" ? body.dailyDate : null;
      if (dailyDate) {
        if (kind !== "Note") throw invalid("dailyDate", "Only timeline notes can be daily notes.");
        if ((await readAll<StoredNote>(NOTES)).some((n) => n.dailyDate === dailyDate)) throw dailyNoteExists();
      }
      const note: StoredNote = {
        id: uuidv7(now.getTime()),
        kind,
        dailyDate,
        content,
        isPinned: body.isPinned === true,
        archivedAtUtc: null,
        trashedAtUtc: null,
        createdAtUtc: nowIso,
        updatedAtUtc: nowIso,
        tags: extractTags(content),
        labelIds: [],
      };
      await write({ notes: [note] });
      return toWire(note);
    }
    case "POST notes/import/existing": {
      const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
      if (ids.length > MAX_IMPORT_IDS) throw invalid("ids", `Ask about at most ${MAX_IMPORT_IDS} IDs at a time.`);
      const notes = await readAll<StoredNote>(NOTES);
      const wanted = new Set(ids.map((i) => i.toLowerCase()));
      return { existing: notes.filter((n) => wanted.has(n.id.toLowerCase())).map((n) => n.id) };
    }
    case "POST notes/import": {
      // Restoring from an export: the note keeps its ID, dates, state, kind, daily date and labels.
      noFiles(body.attachmentIds);
      const notes = await readAll<StoredNote>(NOTES);
      const requested = typeof body.id === "string" ? body.id.toLowerCase() : null;
      const existing = requested ? notes.find((n) => n.id.toLowerCase() === requested) : undefined;
      if (existing) return { imported: false, note: toWire(existing) };

      const kind = validateKind(body.kind);
      const content = validateContent(body.content);
      const created = time(String(body.createdAtUtc));
      if (Number.isNaN(created)) throw invalid("createdAtUtc", "The creation time is not valid.");
      if (created > now.getTime() + 5 * 60_000) throw invalid("createdAtUtc", "A note cannot have been created in the future.");
      // Edit times never lie in the future, nor before the note was created.
      const updated = Math.max(created, Math.min(time(String(body.updatedAtUtc)) || created, now.getTime()));
      const labelIds = checkLabels(body.labelIds, await readAll<StoredLabel>(LABELS));
      const dailyDate = typeof body.dailyDate === "string" && kind === "Note" && !notes.some((n) => n.dailyDate === body.dailyDate) ? body.dailyDate : null;
      const note: StoredNote = {
        id: requested && UUID.test(requested) ? requested : uuidv7(),
        kind,
        dailyDate,
        content,
        isPinned: body.isPinned === true,
        archivedAtUtc: body.isArchived === true ? new Date(updated).toISOString() : null,
        trashedAtUtc: null,
        createdAtUtc: new Date(created).toISOString(),
        updatedAtUtc: new Date(updated).toISOString(),
        tags: extractTags(content),
        labelIds,
      };
      await write({ notes: [note] });
      return { imported: true, note: toWire(note) };
    }
    case "PUT notes/:id": {
      noFiles(body.attachmentIds);
      const note = (await readAll<StoredNote>(NOTES)).find((n) => n.id === id);
      if (!note) throw notFound();
      if (typeof body.expectedUpdatedAtUtc === "string" && time(body.expectedUpdatedAtUtc) !== time(note.updatedAtUtc)) {
        throw new ApiError(409, { title: "This note changed since it was opened." });
      }
      const content = validateContent(body.content);
      const saved = { ...note, content, tags: extractTags(content), updatedAtUtc: nowIso };
      await write({ notes: [saved] });
      return toWire(saved);
    }
    case "PATCH notes/:id": {
      const note = (await readAll<StoredNote>(NOTES)).find((n) => n.id === id);
      if (!note) throw notFound();
      const kind = body.kind === undefined || body.kind === null ? note.kind : validateKind(body.kind);
      // A habit's text has a fixed shape (its days, one per line), so it never moves to or from the other kinds.
      if (kind !== note.kind && (kind === "Habit" || note.kind === "Habit")) {
        throw invalid("kind", "Habits cannot become other kinds of notes, and notes cannot become habits.");
      }
      const saved: StoredNote = { ...note, kind };
      if (typeof body.isPinned === "boolean") saved.isPinned = body.isPinned;
      if (typeof body.isArchived === "boolean") saved.archivedAtUtc = body.isArchived ? (note.archivedAtUtc ?? nowIso) : null;
      if (typeof body.isTrashed === "boolean") saved.trashedAtUtc = body.isTrashed ? (note.trashedAtUtc ?? nowIso) : null;
      if (body.labelIds !== undefined && body.labelIds !== null) saved.labelIds = checkLabels(body.labelIds, await readAll<StoredLabel>(LABELS));
      // A daily note moved out of the timeline, or to the trash, no longer holds its day.
      if (saved.kind !== "Note" || saved.trashedAtUtc !== null) saved.dailyDate = null;
      await write({ notes: [saved] });
      return toWire(saved);
    }
    case "DELETE notes/:id": {
      if (!(await readAll<StoredNote>(NOTES)).some((n) => n.id === id)) throw notFound();
      await write({ deleteNotes: [id!] });
      return undefined;
    }
    case "DELETE notes/trash": {
      const trashed = (await readAll<StoredNote>(NOTES)).filter((n) => n.trashedAtUtc !== null);
      await write({ deleteNotes: trashed.map((n) => n.id) });
      return { notes: trashed.length, files: 0 };
    }
    case "GET tags":
      return listTags(await readAll<StoredNote>(NOTES), params);
    case "GET labels":
      return listLabels(await readAll<StoredLabel>(LABELS), await readAll<StoredNote>(NOTES), kindsOf(params));
    case "POST labels": {
      const labels = await readAll<StoredLabel>(LABELS);
      if (labels.length >= MAX_LABELS) throw new ApiError(409, { title: `You can have at most ${MAX_LABELS} labels.`, detail: "Delete one you no longer use first." });
      const label: StoredLabel = { id: uuidv7(now.getTime()), name: labelName(body.name), color: labelColor(body.color ?? "Grey"), createdAtUtc: nowIso };
      await write({ labels: [label] });
      return { id: label.id, name: label.name, encryptedName: null, color: label.color, noteCount: 0 } satisfies LabelWire;
    }
    case "PUT labels/:id": {
      const labels = await readAll<StoredLabel>(LABELS);
      const label = labels.find((l) => l.id === id);
      if (!label) throw notFound();
      const saved = {
        ...label,
        ...(body.color !== undefined && body.color !== null ? { color: labelColor(body.color) } : {}),
        ...(body.name !== undefined && body.name !== null ? { name: labelName(body.name) } : {}),
      };
      await write({ labels: [saved] });
      return listLabels([saved], await readAll<StoredNote>(NOTES), ["Note", "Todo", "Quick"])[0];
    }
    case "DELETE labels/:id": {
      if (!(await readAll<StoredLabel>(LABELS)).some((l) => l.id === id)) throw notFound();
      const labelled = (await readAll<StoredNote>(NOTES)).filter((n) => n.labelIds.includes(id!));
      await write({ deleteLabels: [id!], notes: labelled.map((n) => ({ ...n, labelIds: n.labelIds.filter((l) => l !== id) })) });
      return undefined;
    }
    case "PUT account/preferences": {
      const preferences = { ...meta.preferences, ...(body as Partial<Preferences>) };
      await write({ meta: { ...meta, preferences } });
      return preferences;
    }
    case "PUT account/display-name": {
      const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (name.length > MAX_DISPLAY_NAME) throw invalid("displayName", `Use at most ${MAX_DISPLAY_NAME} characters.`);
      const saved = { ...meta, displayName: name || "My notebook" };
      await write({ meta: saved });
      return toUser(saved);
    }
    case "GET account/storage": {
      const notes = await readAll<StoredNote>(NOTES);
      const notesBytes = notes.reduce((sum, note) => sum + new TextEncoder().encode(note.content).length, 0);
      return { notesBytes, noteCount: notes.length, filesBytes: 0, fileCount: 0, totalBytes: notesBytes, quotaBytes: null } satisfies StorageUsage;
    }
    case "GET account/encryption":
      return { mode: "Off", inProgress: false, totalItems: 0, remainingItems: 0 } satisfies EncryptionStatus;
    case "GET link-preview":
      return undefined;
    default:
      throw notAvailable();
  }
}

// Requests are answered one at a time, so a change never reads what another is about to overwrite.
let queue: Promise<unknown> = Promise.resolve();

/** Answers an API request from the notebook on this device, as the server would answer it for an account. */
export function deviceRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const answer = queue.then(() => route(method, path, (body ?? {}) as Body));
  queue = answer.catch(() => undefined);
  return answer as Promise<T>;
}
