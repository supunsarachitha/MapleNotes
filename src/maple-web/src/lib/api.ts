import type {
  AdminUser,
  Attachment,
  AttachmentWire,
  AuthStatus,
  CompactResult,
  ConversionBatch,
  CredentialProof,
  DeletedContent,
  EmptyTrashResult,
  EncryptedNoteWire,
  EncryptionMode,
  EncryptionStatus,
  KdfParamsWire,
  Label,
  LabelColor,
  LabelWire,
  LinkPreview,
  Note,
  NoteKind,
  NotePage,
  NotePageWire,
  NoteState,
  NoteWire,
  InstanceSettings,
  InstanceStorage,
  Preferences,
  Prelogin,
  StorageUsage,
  ProblemDetails,
  Tag,
  TagWire,
  TwoFactorSetup,
  TwoFactorStatus,
  User,
  UserRole,
} from "./types";
import { ApiError } from "./apiError";
import { noteApiResponse } from "./offline";
import {
  canKeepOffline,
  forgetPendingChanges,
  hasPendingChange,
  keepEdit,
  keepNewNote,
  pendingDailyNote,
  withPendingChanges,
  type OutboxEntry,
  type Sender,
} from "./outbox";
import {
  decodeAttachment,
  decodeLabels,
  decodeNote,
  decodeTags,
  encodeLabelName,
  encodeNewLabel,
  encodeUpload,
  encodeImport,
  encodeNewNote,
  encodeNoteUpdate,
  matchesSearch,
  needsTagList,
  readsEndToEnd,
  tagFilterParams,
} from "./noteCrypto";

export { ApiError } from "./apiError";

// State-changing requests must carry an antiforgery token (see AuthController on the server). Tokens are bound to
// the signed-in user, so a new one is fetched after signing in or out.
let antiforgery: { token: string; header: string } | null = null;

export async function refreshAntiforgeryToken(): Promise<{ token: string; header: string }> {
  const response = await fetch("/api/v1/auth/antiforgery", { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, await readProblem(response));
  const body = (await response.json()) as { token: string; headerName: string };
  antiforgery = { token: body.token, header: body.headerName };
  return antiforgery;
}

export async function antiforgeryHeaders(): Promise<Record<string, string>> {
  const current = antiforgery ?? (await refreshAntiforgeryToken());
  return { [current.header]: current.token };
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  try {
    return (await response.json()) as ProblemDetails;
  } catch {
    return { status: response.status };
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function request<T>(method: Method, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const raw = body instanceof Blob; // sent as it is, with its own type (an image, for example)
  if (body !== undefined) headers["Content-Type"] = raw ? body.type : "application/json";
  if (method !== "GET") {
    try {
      Object.assign(headers, await antiforgeryHeaders());
    } catch (error) {
      // Offline, the token cannot be fetched, but the service worker may still answer from a saved copy (the password
      // settings for unlocking). A server that is reached refuses the request without one, and the retry below fetches it.
      if (!(error instanceof TypeError)) throw error;
    }
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, { title: "Cannot reach the server. Check your connection and try again." });
  }
  noteApiResponse(response);

  if (!response.ok) {
    const problem = await readProblem(response);
    // A stale token (for example after the session changed in another tab): refresh once and retry.
    if (response.status === 400 && method !== "GET" && retry && problem.title?.toLowerCase().includes("antiforgery")) {
      await refreshAntiforgeryToken();
      return request<T>(method, path, body, false);
    }
    throw new ApiError(response.status, problem);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Sends multipart/form-data (file conversions), with the antiforgery token. */
async function sendForm(method: "POST" | "PUT", path: string, form: FormData): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { method, body: form, headers: await antiforgeryHeaders(), credentials: "same-origin" });
  } catch {
    throw new ApiError(0, { title: "Cannot reach the server. Check your connection and try again." });
  }
  if (!response.ok) throw new ApiError(response.status, await readProblem(response));
}

function query(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== "") search.append(key, String(item));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// The server cannot read end-to-end notes, so for an account with such notes the browser searches: it scans pages of
// notes, as the server's own search does, and returns the matches with the cursor to continue from.
const SEARCH_BATCH = 100;
const SEARCH_SCAN_LIMIT = 5_000;

async function listTags(kinds?: NoteKind[]): Promise<Tag[]> {
  return decodeTags(await request<TagWire[]>("GET", `/api/v1/tags${query({ kind: kinds })}`));
}

/** Notes from the server, with the changes this device has not sent yet shown in them (lib/outbox.ts). */
async function listNotes(params: NoteListParams): Promise<NotePage> {
  const page = await fetchNotes(params);
  return withPendingChanges(page, {
    state: params.state,
    kinds: params.kinds ?? ["Note"],
    firstPage: !params.cursor,
    tag: params.tag,
    label: params.label,
    q: params.q,
    createdFrom: params.createdFrom,
    createdBefore: params.createdBefore,
  });
}

async function fetchNotes(params: NoteListParams): Promise<NotePage> {
  if (params.tag && needsTagList()) await listTags(); // e.g. a link straight to ?tag=work: find work/… first
  const { tag, kinds, ...fields } = params;
  const rest = { ...fields, kind: kinds };
  const filter = tag ? await tagFilterParams(tag) : {};
  if (!params.q || !readsEndToEnd()) {
    const page = await request<NotePageWire>("GET", `/api/v1/notes${query({ ...rest, ...filter })}`);
    return { items: await Promise.all(page.items.map(decodeNote)), nextCursor: page.nextCursor };
  }

  const limit = params.limit ?? 20;
  const matches: Note[] = [];
  let cursor = params.cursor;
  for (let scanned = 0; ; ) {
    const page = await request<NotePageWire>(
      "GET",
      `/api/v1/notes${query({ state: params.state, kind: kinds, label: params.label, createdFrom: params.createdFrom, createdBefore: params.createdBefore, cursor, limit: SEARCH_BATCH, ...filter })}`,
    );
    const notes = await Promise.all(page.items.map(decodeNote));
    matches.push(...notes.filter((note) => matchesSearch(note, params.q!)));
    scanned += notes.length;
    if (!page.nextCursor) return { items: matches, nextCursor: null };
    if (matches.length >= limit || scanned >= SEARCH_SCAN_LIMIT) return { items: matches, nextCursor: page.nextCursor };
    cursor = page.nextCursor;
  }
}

export interface NoteListParams {
  state: NoteState;
  /** Which kinds of notes; the server's default is the timeline ("Note"). */
  kinds?: NoteKind[];
  /** Only notes created from this instant (ISO 8601)… */
  createdFrom?: string;
  /** …and before this one. */
  createdBefore?: string;
  cursor?: string;
  limit?: number;
  tag?: string;
  /** Only notes with this label (its ID). */
  label?: string;
  q?: string;
}

/** What PATCH /api/v1/notes/{id} can change; omitted fields stay as they are. */
export interface NoteChanges {
  isPinned?: boolean;
  isArchived?: boolean;
  kind?: NoteKind;
  /** Move to the trash, or restore from it. */
  isTrashed?: boolean;
  /** The complete set of labels the note should have. */
  labelIds?: string[];
}

// Sign-in endpoints take keys derived from the password, never the password itself; lib/auth.ts derives them.
export const api = {
  status: () => request<AuthStatus>("GET", "/api/v1/auth/status"),

  prelogin: (username: string) => request<Prelogin>("POST", "/api/v1/auth/prelogin", { username }),

  async login(body: { username: string; authKey: string; rememberMe: boolean; password?: string; twoFactorCode?: string }): Promise<User> {
    const user = await request<User>("POST", "/api/v1/auth/login", body);
    await refreshAntiforgeryToken();
    return user;
  },

  async register(body: { username: string; kdf: KdfParamsWire; authKey: string; displayName?: string }): Promise<User> {
    const user = await request<User>("POST", "/api/v1/auth/register", body);
    await refreshAntiforgeryToken();
    return user;
  },

  async logout(): Promise<void> {
    await request<void>("POST", "/api/v1/auth/logout");
    // Only once signed out: a sign-out that cannot reach the server leaves the session, and its changes, as they were.
    await forgetPendingChanges();
    await refreshAntiforgeryToken();
  },

  changePassword: (body: { current: CredentialProof; newKdf: KdfParamsWire; newAuthKey: string; newWrappedKey?: string }) =>
    request<void>("PUT", "/api/v1/auth/password", body),

  /** This session's secret (see crypto/keystore.ts). */
  sessionKey: () => request<{ key: string }>("GET", "/api/v1/auth/session-key"),

  async signOutEverywhere(): Promise<void> {
    await request<void>("POST", "/api/v1/auth/sign-out-everywhere");
    await forgetPendingChanges();
    await refreshAntiforgeryToken();
  },

  /** Notes, decrypted; searches and tag filters also cover end-to-end notes (see noteCrypto.ts). */
  listNotes,

  async createNote(
    content: string,
    attachmentIds: string[],
    options: { isPinned?: boolean; kind?: NoteKind; dailyDate?: string } = {},
  ): Promise<Note> {
    const fields = await encodeNewNote(content);
    const { isPinned = false, kind = "Note", dailyDate } = options;
    try {
      return await decodeNote(await request<NoteWire>("POST", "/api/v1/notes", { ...fields, attachmentIds, isPinned, kind, dailyDate }));
    } catch (error) {
      // Kept on this device and sent later, when the server cannot be reached (lib/outbox.ts).
      if (error instanceof ApiError && canKeepOffline(error.status)) return keepNewNote(content, attachmentIds, options);
      throw error;
    }
  },

  /** How many active notes of these kinds were created on each day from `from` to `to` (yyyy-MM-dd), in a time zone. */
  calendar: (from: string, to: string, timeZone: string, kinds: NoteKind[]) =>
    request<Array<{ date: string; count: number }>>("GET", `/api/v1/notes/calendar${query({ from, to, timeZone, kind: kinds })}`),

  /** A link's title, description and site, fetched by the server; null when the page has none. */
  async linkPreview(url: string): Promise<LinkPreview | null> {
    return (await request<LinkPreview | undefined>("GET", `/api/v1/link-preview${query({ url })}`)) ?? null;
  },

  /** Which of these note IDs the account already has (at most 500 at a time). */
  async existingNotes(ids: string[]): Promise<string[]> {
    return (await request<{ existing: string[] }>("POST", "/api/v1/notes/import/existing", { ids })).existing;
  },

  /**
   * Restores one note with its original ID, dates, state, kind, daily date and labels (the account's own, at most 20).
   * A note the account already has is left as it is (`imported: false`). An end-to-end note whose ID another account uses is encrypted again for a new ID.
   */
  async importNote(
    note: { id: string | null; content: string; createdAt: Date; updatedAt: Date; pinned: boolean; archived: boolean; kind: NoteKind; dailyDate: string | null },
    attachmentIds: string[],
    labelIds: string[] = [],
  ): Promise<{ imported: boolean; note: Note }> {
    const body = {
      createdAtUtc: note.createdAt.toISOString(),
      updatedAtUtc: note.updatedAt.toISOString(),
      attachmentIds,
      isPinned: note.pinned,
      isArchived: note.archived,
      kind: note.kind,
      dailyDate: note.dailyDate,
      labelIds,
    };
    const send = async (fresh: boolean) => {
      const result = await request<{ imported: boolean; note: NoteWire }>("POST", "/api/v1/notes/import", {
        ...body,
        ...(await encodeImport(note.id, note.content, fresh)),
      });
      return { imported: result.imported, note: await decodeNote(result.note) };
    };
    try {
      return await send(false);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || !readsEndToEnd()) throw error;
      return send(true);
    }
  },

  /** The daily note of a day (`yyyy-MM-dd`), or null when the day has none yet. */
  async dailyNote(date: string): Promise<Note | null> {
    try {
      const note = await decodeNote(await request<NoteWire>("GET", `/api/v1/notes/daily/${date}`));
      return (await withPendingChanges({ items: [note], nextCursor: null }, { state: "active", kinds: [], firstPage: false })).items[0]!;
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && !canKeepOffline(error.status))) throw error;
      // The day's note may have been started offline, on this device.
      const pending = await pendingDailyNote(date);
      if (pending || error.status === 404) return pending;
      throw error;
    }
  },

  /**
   * Replaces a note's text. `seen` is the note as it was shown: with it, an edit that cannot reach the server is kept on
   * this device and sent later, and only if the note has not been edited elsewhere meanwhile (lib/outbox.ts).
   */
  async updateNote(id: string, content: string, attachmentIds: string[], seen?: Note): Promise<Note> {
    // A note with a change still waiting here gets this one queued behind it, so they reach the server in order.
    if (seen && (await hasPendingChange(id))) {
      const kept = await keepEdit(seen, content, attachmentIds);
      void syncNow();
      return kept;
    }
    const fields = await encodeNoteUpdate(id, content);
    try {
      return await decodeNote(await request<NoteWire>("PUT", `/api/v1/notes/${id}`, { ...fields, attachmentIds }));
    } catch (error) {
      if (seen && error instanceof ApiError && canKeepOffline(error.status)) return keepEdit(seen, content, attachmentIds);
      throw error;
    }
  },

  async patchNote(id: string, changes: NoteChanges): Promise<Note> {
    return decodeNote(await request<NoteWire>("PATCH", `/api/v1/notes/${id}`, changes));
  },

  /** Deletes a note for good, whether or not it is in the trash. */
  deleteNote: (id: string) => request<void>("DELETE", `/api/v1/notes/${id}`),

  /** Deletes every note in the trash for good. */
  emptyTrash: () => request<EmptyTrashResult>("DELETE", "/api/v1/notes/trash"),

  /** Coloured labels, with end-to-end names decrypted (and encrypted when saved, see noteCrypto.ts). */
  labels: {
    async list(kinds?: NoteKind[]): Promise<Label[]> {
      return decodeLabels(await request<LabelWire[]>("GET", `/api/v1/labels${query({ kind: kinds })}`));
    },
    async create(name: string, color: LabelColor): Promise<Label> {
      const wire = await request<LabelWire>("POST", "/api/v1/labels", { ...(await encodeNewLabel(name)), color });
      return (await decodeLabels([wire]))[0]!;
    },
    async update(id: string, changes: { name?: string; color?: LabelColor }): Promise<Label> {
      const name = changes.name === undefined ? {} : await encodeLabelName(id, changes.name);
      const wire = await request<LabelWire>("PUT", `/api/v1/labels/${id}`, { ...name, color: changes.color });
      return (await decodeLabels([wire]))[0]!;
    },
    remove: (id: string) => request<void>("DELETE", `/api/v1/labels/${id}`),
  },

  /** Tags with end-to-end tag names decrypted. */
  listTags,

  deleteAttachment: (id: string) => request<void>("DELETE", `/api/v1/attachments/${id}`),

  /** Writing and feature preferences; the whole object is replaced (fields left out take their defaults). */
  setPreferences: (preferences: Preferences) => request<Preferences>("PUT", "/api/v1/account/preferences", preferences),

  /** How much this account stores (its own notes and files only). */
  storage: () => request<StorageUsage>("GET", "/api/v1/account/storage"),

  encryption: () => request<EncryptionStatus>("GET", "/api/v1/account/encryption"),

  /**
   * Off or at rest; or back to end-to-end while the account still has its key (the first time uses e2ee.enable). An
   * account with an end-to-end key also sends the new mode sealed with it (lib/modeRecord.ts).
   */
  setEncryption: (mode: EncryptionMode, proof: CredentialProof, modeRecord?: string) =>
    request<EncryptionStatus>("PUT", "/api/v1/account/encryption", { mode, proof, ...(modeRecord ? { modeRecord } : {}) }),

  /** The browser's conversion of existing content after a change to or from end-to-end encryption. */
  conversion: {
    batch: (limit = 10) => request<ConversionBatch>("GET", `/api/v1/account/conversion${query({ limit })}`),
    note: (id: string, body: { updatedAtUtc: string; content?: string; encrypted?: EncryptedNoteWire }) =>
      request<void>("PUT", `/api/v1/account/conversion/notes/${id}`, body),
    attachment: (id: string, form: FormData) => sendForm("PUT", `/api/v1/account/conversion/attachments/${id}`, form),
  },

  /** End-to-end key material; the server stores it wrapped and cannot open it (docs/e2ee-spec.md §3, §6). */
  e2ee: {
    key: () => request<{ wrappedKey: string }>("GET", "/api/v1/account/e2ee"),
    enable: (body: { proof: CredentialProof; wrappedKey: string; recoveryWrappedKey: string; recoveryAuthKey: string; modeRecord: string }) =>
      request<EncryptionStatus>("POST", "/api/v1/account/e2ee", body),
    replaceRecoveryKey: (body: { proof: CredentialProof; recoveryWrappedKey: string; recoveryAuthKey: string }) =>
      request<void>("PUT", "/api/v1/account/e2ee/recovery", body),
  },

  /** Password reset with the recovery key of an end-to-end account. */
  recovery: {
    key: (username: string, recoveryAuthKey: string) =>
      request<{ userId: string; recoveryWrappedKey: string }>("POST", "/api/v1/auth/recovery/key", { username, recoveryAuthKey }),
    async reset(body: {
      username: string;
      recoveryAuthKey: string;
      newKdf: KdfParamsWire;
      newAuthKey: string;
      newWrappedKey: string;
      newRecoveryWrappedKey: string;
      newRecoveryAuthKey: string;
      twoFactorCode?: string;
    }): Promise<User> {
      const user = await request<User>("POST", "/api/v1/auth/recovery/reset", body);
      await refreshAntiforgeryToken();
      return user;
    },
  },

  /** Optional two-factor sign-in with an authenticator app. */
  twoFactor: {
    status: () => request<TwoFactorStatus>("GET", "/api/v1/account/two-factor"),
    setup: () => request<TwoFactorSetup>("POST", "/api/v1/account/two-factor/setup"),
    /** Turns it on and returns the recovery codes. Other sessions end; this one is signed in again. */
    async enable(body: { proof: CredentialProof; secret: string; code: string }): Promise<string[]> {
      const { codes } = await request<{ codes: string[] }>("POST", "/api/v1/account/two-factor", body);
      await refreshAntiforgeryToken();
      return codes;
    },
    disable: (body: { proof: CredentialProof; code: string }) => request<void>("DELETE", "/api/v1/account/two-factor", body),
    replaceRecoveryCodes: async (body: { proof: CredentialProof; code: string }) =>
      (await request<{ codes: string[] }>("POST", "/api/v1/account/two-factor/recovery-codes", body)).codes,
  },

  /** Changes the name the app shows for this account; an empty name goes back to the username. */
  updateDisplayName: (displayName: string) => request<User>("PUT", "/api/v1/account/display-name", { displayName }),

  /** Deletes every note, tag and file of the account; the account, its keys and settings stay. */
  async deleteAllContent(proof: CredentialProof): Promise<DeletedContent> {
    const deleted = await request<DeletedContent>("DELETE", "/api/v1/account/content", { proof });
    await forgetPendingChanges(); // changes to notes that no longer exist
    return deleted;
  },

  async deleteAccount(proof: CredentialProof): Promise<void> {
    await request<void>("DELETE", "/api/v1/account", { proof });
    await forgetPendingChanges();
    await refreshAntiforgeryToken();
  },

  admin: {
    settings: () => request<InstanceSettings>("GET", "/api/v1/admin/settings"),
    /** Replaces all the settings, so send every field. */
    updateSettings: (settings: InstanceSettings) => request<InstanceSettings>("PUT", "/api/v1/admin/settings", settings),
    users: () => request<AdminUser[]>("GET", "/api/v1/admin/users"),
    updateUser: (id: string, changes: { isDisabled?: boolean; role?: UserRole; turnOffTwoFactor?: boolean }) =>
      request<void>("PATCH", `/api/v1/admin/users/${id}`, changes),
    deleteUser: (id: string) => request<void>("DELETE", `/api/v1/admin/users/${id}`),
    /** The instance's totals on its data volume; never another account's usage. */
    storage: () => request<InstanceStorage>("GET", "/api/v1/admin/storage"),
    /** Replaces the app's icon with a PNG, JPEG or WebP image (at most 256 KB). */
    setIcon: (image: Blob) => request<void>("PUT", "/api/v1/admin/branding/icon", image),
    /** Goes back to the maple leaf. */
    removeIcon: () => request<void>("DELETE", "/api/v1/admin/branding/icon"),
    /** Rebuilds the database without the space deleted content left behind. */
    compactDatabase: () => request<CompactResult>("POST", "/api/v1/admin/storage/compact"),
  },
};

/** Sends the changes kept on this device (lib/outbox.ts) through the API. */
export const outboxSender: Sender = {
  async create(entry: OutboxEntry, content: string): Promise<Note> {
    // Restoring is idempotent by ID, so a note whose first send got through without an answer is not added twice, and it
    // keeps the time it was written. A daily note keeps its day unless another device started that day's note meanwhile.
    const { note } = await api.importNote(
      {
        id: entry.noteId,
        content,
        createdAt: new Date(entry.createdAtUtc),
        updatedAt: new Date(entry.changedAtUtc),
        pinned: entry.isPinned,
        archived: false,
        kind: entry.kind,
        dailyDate: entry.dailyDate,
      },
      entry.attachmentIds,
    );
    return note;
  },
  async update(entry: OutboxEntry, content: string): Promise<Note> {
    const fields = await encodeNoteUpdate(entry.noteId, content);
    const body = { ...fields, attachmentIds: entry.attachmentIds, expectedUpdatedAtUtc: entry.baseUpdatedAtUtc };
    return decodeNote(await request<NoteWire>("PUT", `/api/v1/notes/${entry.noteId}`, body));
  },
  async current(noteId: string): Promise<Note | null> {
    try {
      return await decodeNote(await request<NoteWire>("GET", `/api/v1/notes/${noteId}`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  async saveCopy(entry: OutboxEntry, content: string): Promise<void> {
    // Habits keep their kind; a copy of a daily note is an ordinary note, since the day already has one.
    await request<NoteWire>("POST", "/api/v1/notes", { ...(await encodeNewNote(content)), attachmentIds: [], kind: entry.kind });
  },
};

let syncListener: (() => void) | null = null;

/** Asks the app to send the kept changes now (lib/outboxSync.ts registers what that does). */
export function syncNow(): void {
  syncListener?.();
}

export function onSyncRequest(listener: (() => void) | null): void {
  syncListener = listener;
}

/**
 * Uploads a file with progress reporting (fetch cannot report upload progress, so this uses XMLHttpRequest).
 * The server streams the file straight to encrypted storage. In end-to-end mode the file is encrypted here first, and
 * the ID and encrypted metadata travel as form fields ahead of it.
 */
export async function uploadAttachment(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Attachment> {
  const headers = await antiforgeryHeaders();
  const encrypted = await encodeUpload(file);
  const wire = await new Promise<AttachmentWire>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/attachments");
    xhr.responseType = "json";
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response as AttachmentWire);
      else reject(new ApiError(xhr.status, (xhr.response as ProblemDetails | null) ?? {}));
    };
    xhr.onerror = () => reject(new ApiError(0, { title: "Upload failed. Check your connection and try again." }));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());

    const form = new FormData();
    if (encrypted) {
      form.append("id", encrypted.id);
      form.append("metadata", encrypted.metadata);
      form.append("file", encrypted.body, "encrypted.bin");
    } else {
      form.append("file", file, file.name);
    }
    xhr.send(form);
  });
  return decodeAttachment(wire);
}
