import type {
  AdminUser,
  Attachment,
  AttachmentWire,
  AuthStatus,
  ConversionBatch,
  CredentialProof,
  EncryptedNoteWire,
  EncryptionMode,
  EncryptionStatus,
  KdfParamsWire,
  Note,
  NoteKind,
  NotePage,
  NotePageWire,
  NoteState,
  NoteWire,
  Preferences,
  Prelogin,
  ProblemDetails,
  Tag,
  TagWire,
  User,
  UserRole,
} from "./types";
import { ApiError } from "./apiError";
import {
  decodeAttachment,
  decodeNote,
  decodeTags,
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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") Object.assign(headers, await antiforgeryHeaders());

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, { title: "Cannot reach the server. Check your connection and try again." });
  }

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

async function listNotes(params: NoteListParams): Promise<NotePage> {
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
      `/api/v1/notes${query({ state: params.state, kind: kinds, createdFrom: params.createdFrom, createdBefore: params.createdBefore, cursor, limit: SEARCH_BATCH, ...filter })}`,
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
  q?: string;
}

// Sign-in endpoints take keys derived from the password, never the password itself; lib/auth.ts derives them.
export const api = {
  status: () => request<AuthStatus>("GET", "/api/v1/auth/status"),

  prelogin: (username: string) => request<Prelogin>("POST", "/api/v1/auth/prelogin", { username }),

  async login(body: { username: string; authKey: string; rememberMe: boolean; password?: string }): Promise<User> {
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
    await refreshAntiforgeryToken();
  },

  changePassword: (body: { current: CredentialProof; newKdf: KdfParamsWire; newAuthKey: string; newWrappedKey?: string }) =>
    request<void>("PUT", "/api/v1/auth/password", body),

  /** This session's secret (see crypto/keystore.ts). */
  sessionKey: () => request<{ key: string }>("GET", "/api/v1/auth/session-key"),

  async signOutEverywhere(): Promise<void> {
    await request<void>("POST", "/api/v1/auth/sign-out-everywhere");
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
    return decodeNote(await request<NoteWire>("POST", "/api/v1/notes", { ...fields, attachmentIds, isPinned, kind, dailyDate }));
  },

  /** How many active notes of these kinds were created on each day from `from` to `to` (yyyy-MM-dd), in a time zone. */
  calendar: (from: string, to: string, timeZone: string, kinds: NoteKind[]) =>
    request<Array<{ date: string; count: number }>>("GET", `/api/v1/notes/calendar${query({ from, to, timeZone, kind: kinds })}`),

  /** Which of these note IDs the account already has (at most 500 at a time). */
  async existingNotes(ids: string[]): Promise<string[]> {
    return (await request<{ existing: string[] }>("POST", "/api/v1/notes/import/existing", { ids })).existing;
  },

  /**
   * Restores one note with its original ID, dates, state, kind and daily date. A note the account already has is
   * left as it is (`imported: false`). An end-to-end note whose ID another account uses is encrypted again for a new ID.
   */
  async importNote(
    note: { id: string | null; content: string; createdAt: Date; updatedAt: Date; pinned: boolean; archived: boolean; kind: NoteKind; dailyDate: string | null },
    attachmentIds: string[],
  ): Promise<{ imported: boolean; note: Note }> {
    const body = {
      createdAtUtc: note.createdAt.toISOString(),
      updatedAtUtc: note.updatedAt.toISOString(),
      attachmentIds,
      isPinned: note.pinned,
      isArchived: note.archived,
      kind: note.kind,
      dailyDate: note.dailyDate,
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
      return await decodeNote(await request<NoteWire>("GET", `/api/v1/notes/daily/${date}`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  async updateNote(id: string, content: string, attachmentIds: string[]): Promise<Note> {
    const fields = await encodeNoteUpdate(id, content);
    return decodeNote(await request<NoteWire>("PUT", `/api/v1/notes/${id}`, { ...fields, attachmentIds }));
  },

  async patchNote(id: string, changes: { isPinned?: boolean; isArchived?: boolean; kind?: NoteKind }): Promise<Note> {
    return decodeNote(await request<NoteWire>("PATCH", `/api/v1/notes/${id}`, changes));
  },

  deleteNote: (id: string) => request<void>("DELETE", `/api/v1/notes/${id}`),

  /** Tags with end-to-end tag names decrypted. */
  listTags,

  deleteAttachment: (id: string) => request<void>("DELETE", `/api/v1/attachments/${id}`),

  /** Writing and feature preferences; the whole object is replaced (fields left out take their defaults). */
  setPreferences: (preferences: Preferences) => request<Preferences>("PUT", "/api/v1/account/preferences", preferences),

  encryption: () => request<EncryptionStatus>("GET", "/api/v1/account/encryption"),

  /** Off or at rest; or back to end-to-end while the account still has its key (the first time uses e2ee.enable). */
  setEncryption: (mode: EncryptionMode, proof: CredentialProof) =>
    request<EncryptionStatus>("PUT", "/api/v1/account/encryption", { mode, proof }),

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
    enable: (body: { proof: CredentialProof; wrappedKey: string; recoveryWrappedKey: string; recoveryAuthKey: string }) =>
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
    }): Promise<User> {
      const user = await request<User>("POST", "/api/v1/auth/recovery/reset", body);
      await refreshAntiforgeryToken();
      return user;
    },
  },

  async deleteAccount(proof: CredentialProof): Promise<void> {
    await request<void>("DELETE", "/api/v1/account", { proof });
    await refreshAntiforgeryToken();
  },

  admin: {
    settings: () => request<{ allowRegistration: boolean }>("GET", "/api/v1/admin/settings"),
    updateSettings: (allowRegistration: boolean) =>
      request<{ allowRegistration: boolean }>("PUT", "/api/v1/admin/settings", { allowRegistration }),
    users: () => request<AdminUser[]>("GET", "/api/v1/admin/users"),
    updateUser: (id: string, changes: { isDisabled?: boolean; role?: UserRole }) =>
      request<void>("PATCH", `/api/v1/admin/users/${id}`, changes),
    deleteUser: (id: string) => request<void>("DELETE", `/api/v1/admin/users/${id}`),
  },
};

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
