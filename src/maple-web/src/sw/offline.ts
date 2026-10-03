// Offline reading (docs/architecture.md, "Offline reading"). The service worker keeps two things for when the server
// cannot be reached:
//
// - The app itself: the page, its scripts, styles and icons, saved when the worker installs and replaced by each new
//   version, so the app opens without a connection.
// - What the signed-in account last read: the sign-in status, note lists, tags and labels, exactly as the server sent
//   them (still encrypted for end-to-end accounts), and for end-to-end accounts what unlocking needs (the password
//   settings and the wrapped key), so the password still opens the notes offline.
//
// Reads always go to the server first; a saved copy is used only when the request fails. Copies are kept only while
// the server says the session was started with "keep me signed in", and only for that account: a status without it,
// another account, a change of encryption mode, a 401 or a sign-out deletes them all. Kept free of worker globals so
// tests can drive it.

export const DATA_CACHE = "maple-offline-data";
export const SHELL_CACHE_PREFIX = "maple-app-";

/** Set on a response answered from a saved copy, so the page can say it is showing one. */
export const OFFLINE_HEADER = "X-Maple-Offline";

/** Most saved reads; the oldest go first. */
export const MAX_SAVED_READS = 300;

const OWNER_KEY = "/__maple-offline/owner";
const PRELOGIN_KEY = "/__maple-offline/prelogin";
const STATUS_KEY = "/api/v1/auth/status";

/** Reads worth keeping. Anything else under /api/v1 (files, the session's secret, administration) is never kept. */
const SAVED_READS = ["/api/v1/notes", "/api/v1/tags", "/api/v1/labels", "/api/v1/account/e2ee", "/api/v1/account/encryption"];

/** Requests after which nothing may stay on the device. */
const SIGN_OUTS = ["POST /api/v1/auth/logout", "POST /api/v1/auth/sign-out-everywhere", "DELETE /api/v1/account"];

export interface OfflineDeps {
  /** The app's origin, which relative paths resolve against. */
  origin: string;
  caches: Pick<CacheStorage, "open" | "delete" | "keys">;
  fetch: (request: Request) => Promise<Response>;
}

/** The account the saved reads belong to. */
interface Owner {
  userId: string;
  username: string;
  mode: string;
}

type ApiKind = "status" | "read" | "prelogin" | "sign-out";

/** What the worker does with a request to the API, or null to leave it alone. */
export function apiKind(request: Request, origin: string): ApiKind | null {
  const url = new URL(request.url);
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/")) return null;
  const path = url.pathname;
  if (SIGN_OUTS.includes(`${request.method} ${path}`)) return "sign-out";
  if (request.method === "POST" && path === "/api/v1/auth/prelogin") return "prelogin";
  if (request.method !== "GET") return null;
  if (path === "/api/v1/auth/status") return "status";
  // Searches are left out: each one is a new address, and they would push out the lists that were read.
  if (url.searchParams.has("q")) return null;
  return SAVED_READS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? "read" : null;
}

async function readOwner(cache: Cache): Promise<Owner | null> {
  const saved = await cache.match(OWNER_KEY);
  if (!saved) return null;
  try {
    return (await saved.json()) as Owner;
  } catch {
    return null;
  }
}

const sameOwner = (a: Owner | null, b: Owner | null) =>
  a !== null && b !== null && a.userId === b.userId && a.username === b.username && a.mode === b.mode;

/** Deletes every saved read and the owner with them. */
export async function forgetSavedReads(deps: OfflineDeps): Promise<void> {
  await deps.caches.delete(DATA_CACHE);
}

/** A saved response, marked as such; the body and headers are the server's. */
function fromSaved(saved: Response): Response {
  const headers = new Headers(saved.headers);
  headers.set(OFFLINE_HEADER, "1");
  return new Response(saved.body, { status: saved.status, statusText: saved.statusText, headers });
}

/** Saves a read for the owner it was requested for, unless the owner changed while it was on its way. */
async function save(deps: OfflineDeps, owner: Owner, key: string, response: Response): Promise<void> {
  // Opened again rather than reused: a sign-out while the request was on its way deletes the cache it was read from.
  const cache = await deps.caches.open(DATA_CACHE);
  if (!sameOwner(owner, await readOwner(cache))) return;
  await cache.put(key, response);
  const keys = (await cache.keys()).filter((request) => {
    const path = new URL(request.url).pathname;
    return path !== OWNER_KEY && path !== PRELOGIN_KEY && path !== STATUS_KEY;
  });
  // Cache keys keep the order entries were last written in, so the first ones are the least recently read.
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SAVED_READS))) await cache.delete(old);
}

async function handleStatus(request: Request, deps: OfflineDeps): Promise<Response> {
  const cache = await deps.caches.open(DATA_CACHE);
  const owner = await readOwner(cache);
  let response: Response;
  try {
    response = await deps.fetch(request);
  } catch {
    const saved = owner ? await cache.match(STATUS_KEY) : undefined;
    return saved ? fromSaved(saved) : Response.error();
  }
  if (!response.ok) return response;

  let status: { user?: { id?: string; username?: string; encryptionMode?: string } | null; sessionPersistent?: boolean };
  try {
    status = (await response.clone().json()) as typeof status;
  } catch {
    return response;
  }
  const user = status.user;
  if (!user?.id || !user.username || !user.encryptionMode || status.sessionPersistent !== true) {
    await forgetSavedReads(deps);
    return response;
  }
  const current: Owner = { userId: user.id, username: user.username, mode: user.encryptionMode };
  if (!sameOwner(owner, current)) {
    // Another account, or the same one in another mode (a copy saved before a switch to end-to-end encryption would
    // otherwise keep its plain text): start again.
    await forgetSavedReads(deps);
    const fresh = await deps.caches.open(DATA_CACHE);
    await fresh.put(OWNER_KEY, Response.json(current));
  }
  await save(deps, current, STATUS_KEY, response.clone());
  return response;
}

async function handleRead(request: Request, deps: OfflineDeps): Promise<Response> {
  const cache = await deps.caches.open(DATA_CACHE);
  const owner = await readOwner(cache);
  let response: Response;
  try {
    response = await deps.fetch(request);
  } catch {
    const saved = owner ? await cache.match(request.url) : undefined;
    return saved ? fromSaved(saved) : Response.error();
  }
  if (response.status === 401) {
    await forgetSavedReads(deps); // the session has ended
  } else if (response.ok && owner) {
    await save(deps, owner, request.url, response.clone());
  }
  return response;
}

/** The password settings are fetched with a POST that names the account; only the owner's are kept. */
async function handlePrelogin(request: Request, deps: OfflineDeps): Promise<Response> {
  const cache = await deps.caches.open(DATA_CACHE);
  const owner = await readOwner(cache);
  let username = "";
  try {
    username = String(((await request.clone().json()) as { username?: unknown }).username ?? "");
  } catch {
    // not JSON: the server answers it
  }
  const forOwner = owner !== null && username.trim().toUpperCase() === owner.username.toUpperCase();
  let response: Response;
  try {
    response = await deps.fetch(request);
  } catch {
    const saved = forOwner ? await cache.match(PRELOGIN_KEY) : undefined;
    return saved ? fromSaved(saved) : Response.error();
  }
  if (response.ok && forOwner) await save(deps, owner, PRELOGIN_KEY, response.clone());
  return response;
}

/** Answers a request to the API that `apiKind` chose. */
export async function handleApi(request: Request, kind: ApiKind, deps: OfflineDeps): Promise<Response> {
  switch (kind) {
    case "status":
      return handleStatus(request, deps);
    case "read":
      return handleRead(request, deps);
    case "prelogin":
      return handlePrelogin(request, deps);
    case "sign-out":
      // Deleted first, whether or not the server is reached: the person asked for nothing to stay here.
      await forgetSavedReads(deps);
      return deps.fetch(request);
  }
}

/** The app's own files: the page at "/", and what `vite.sw.config.ts` found in the build. */
export interface Shell {
  version: string;
  files: string[];
}

export const shellCache = (shell: Shell) => `${SHELL_CACHE_PREFIX}${shell.version}`;

/** Saves the app's files. A file that cannot be fetched now is left out rather than failing the install. */
export async function saveShell(shell: Shell, deps: OfflineDeps): Promise<void> {
  if (shell.files.length === 0) return; // development: Vite serves the files itself
  const cache = await deps.caches.open(shellCache(shell));
  await Promise.allSettled(
    ["/", ...shell.files].map(async (path) => {
      const response = await deps.fetch(new Request(new URL(path, deps.origin), { cache: "reload", credentials: "same-origin" }));
      if (response.ok) await cache.put(path, response);
    }),
  );
}

/** Deletes the files of earlier versions. */
export async function dropOldShells(shell: Shell, deps: OfflineDeps): Promise<void> {
  const current = shellCache(shell);
  for (const name of await deps.caches.keys()) {
    if (name.startsWith(SHELL_CACHE_PREFIX) && name !== current) await deps.caches.delete(name);
  }
}

/** Whether the worker answers this request for the app's own files. */
export function isShellRequest(request: Request, origin: string, shell: Shell): boolean {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET" || shell.files.length === 0) return false;
  if (request.mode === "navigate") return !/^\/(api|e2ee)\//.test(url.pathname);
  return shell.files.includes(url.pathname);
}

/**
 * The app's files: fingerprinted files under /assets never change, so the saved copy is used; the page and the other
 * files (whose names stay the same across versions) come from the server when it answers, and are saved again.
 */
export async function handleShell(request: Request, shell: Shell, deps: OfflineDeps): Promise<Response> {
  const cache = await deps.caches.open(shellCache(shell));
  const url = new URL(request.url);
  const key = request.mode === "navigate" ? "/" : url.pathname;
  if (key.startsWith("/assets/")) {
    const saved = await cache.match(key);
    if (saved) return saved;
  }
  try {
    const response = await deps.fetch(request);
    // Any route of the app gets the same page, so one copy serves them all; only a real page is kept.
    const isPage = request.mode !== "navigate" || (response.headers.get("Content-Type") ?? "").startsWith("text/html");
    if (response.ok && isPage && !response.redirected) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) ?? Response.error();
  }
}
