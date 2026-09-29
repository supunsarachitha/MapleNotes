import { importDataKey, type DataKeys } from "./datakey";
import { uuidN } from "./encoding";
import { open, seal } from "./envelope";
import { importAesKey } from "./hkdf";

// Keeps the unlocked end-to-end key in this browser between page loads (docs/e2ee-spec.md §7). The key is stored
// sealed under the session's secret, which lives in the HttpOnly session cookie and which only a valid session can
// fetch from the server (GET /api/v1/auth/session-key). So the saved copy is useless once the session ends (sign-out,
// expiry, password change elsewhere, "sign out everywhere"), and the server alone has nothing to decrypt either.
// IndexedDB rather than localStorage, because the media service worker needs to read it too.

const DB_NAME = "maple-notes";
const STORE = "unlocked-keys";

export const localKeyContext = (userId: string) => `maple-notes/v2/local/${uuidN(userId)}`;

interface SavedKey {
  userId: string;
  sealed: Uint8Array;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB request failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB request was aborted."));
    });
  } finally {
    db.close();
  }
}

/** Saves the raw data key for `userId`, sealed under the session secret. The caller wipes `raw`. */
export async function saveLocalKey(userId: string, raw: Uint8Array, version: number, sessionKey: Uint8Array): Promise<void> {
  const sealed = await seal(await importAesKey(sessionKey), raw, localKeyContext(userId), { keyVersion: version });
  await withStore("readwrite", (store) => store.put({ userId, sealed } satisfies SavedKey));
}

/**
 * Loads the saved key for `userId`, or null when there is none or it no longer opens (the session changed). A copy
 * that no longer opens is deleted.
 */
export async function loadLocalKey(userId: string, sessionKey: Uint8Array): Promise<DataKeys | null> {
  const saved = await withStore<SavedKey | undefined>("readonly", (store) => store.get(userId));
  if (!saved) return null;
  let raw: Uint8Array;
  try {
    raw = await open(await importAesKey(sessionKey), saved.sealed, localKeyContext(userId));
  } catch {
    await withStore("readwrite", (store) => store.delete(userId));
    return null;
  }
  try {
    return await importDataKey(raw, saved.sealed[1] ?? 1);
  } finally {
    raw.fill(0);
  }
}

/** Deletes every saved key in this browser (sign-out, or finding the session gone). */
export async function forgetLocalKeys(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}
