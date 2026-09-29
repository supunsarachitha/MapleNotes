import type {
  AdminUser,
  Attachment,
  AuthStatus,
  CredentialProof,
  EncryptionMode,
  EncryptionStatus,
  KdfParamsWire,
  Note,
  NotePage,
  NoteState,
  Prelogin,
  ProblemDetails,
  Tag,
  User,
  UserRole,
} from "./types";

/** An API error with the server's problem details (title, field errors). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.title ?? (status === 0 ? "Cannot reach the server." : `Request failed (${status}).`));
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** The first error message for a request field (camelCase), if any. */
  fieldError(field: string): string | undefined {
    return this.problem.errors?.[field]?.[0];
  }
}

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

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface NoteListParams {
  state: NoteState;
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

  listNotes: (params: NoteListParams) => request<NotePage>("GET", `/api/v1/notes${query({ ...params })}`),

  createNote: (content: string, attachmentIds: string[], isPinned = false) =>
    request<Note>("POST", "/api/v1/notes", { content, attachmentIds, isPinned }),

  updateNote: (id: string, content: string, attachmentIds: string[]) =>
    request<Note>("PUT", `/api/v1/notes/${id}`, { content, attachmentIds }),

  patchNote: (id: string, changes: { isPinned?: boolean; isArchived?: boolean }) =>
    request<Note>("PATCH", `/api/v1/notes/${id}`, changes),

  deleteNote: (id: string) => request<void>("DELETE", `/api/v1/notes/${id}`),

  listTags: () => request<Tag[]>("GET", "/api/v1/tags"),

  deleteAttachment: (id: string) => request<void>("DELETE", `/api/v1/attachments/${id}`),

  encryption: () => request<EncryptionStatus>("GET", "/api/v1/account/encryption"),

  setEncryption: (mode: Exclude<EncryptionMode, "EndToEnd">, proof: CredentialProof) =>
    request<EncryptionStatus>("PUT", "/api/v1/account/encryption", { mode, proof }),

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
 * The server streams the file straight to encrypted storage.
 */
export async function uploadAttachment(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Attachment> {
  const headers = await antiforgeryHeaders();
  return new Promise<Attachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/attachments");
    xhr.responseType = "json";
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response as Attachment);
      else reject(new ApiError(xhr.status, (xhr.response as ProblemDetails | null) ?? {}));
    };
    xhr.onerror = () => reject(new ApiError(0, { title: "Upload failed. Check your connection and try again." }));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
