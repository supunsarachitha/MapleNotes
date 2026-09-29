import { argon2Master, validateKdf, type KdfParams } from "./argon2";
import { concat, utf8, type Bytes } from "./encoding";

// Password-derived keys and HKDF helpers (docs/e2ee-spec.md §1). The expensive Argon2id step runs in a Web Worker in
// the browser so the page stays responsive; where Workers are unavailable (tests) it runs inline.

export { DEFAULT_KDF, validateKdf, type KdfParams } from "./argon2";

const EMPTY_SALT = new Uint8Array(0);

let worker: Worker | null = null;
let nextRequest = 1;
const pending = new Map<number, { resolve: (value: Bytes) => void; reject: (reason: Error) => void }>();

function kdfWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./kdf.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; master?: Uint8Array; error?: string }>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      if (event.data.master) request.resolve(concat(event.data.master));
      else request.reject(new Error(event.data.error ?? "Password derivation failed."));
    };
  }
  return worker;
}

/** Argon2id master secret, computed off the main thread when possible. */
export async function deriveMasterSecret(password: string, params: KdfParams): Promise<Bytes> {
  validateKdf(params);
  const target = kdfWorker();
  if (!target) return argon2Master(password, params);
  const id = nextRequest++;
  return new Promise<Bytes>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, password, params: { ...params, salt: concat(params.salt) } });
  });
}

/** HKDF-SHA256 → 32 bytes (empty salt unless given). */
export async function hkdfBytes(ikm: Uint8Array, info: string, salt: Uint8Array = EMPTY_SALT): Promise<Bytes> {
  const base = await crypto.subtle.importKey("raw", concat(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: concat(salt), info: utf8(info) }, base, 256),
  );
}

/** HKDF-SHA256 from a base key → a non-extractable AES-256-GCM key. */
export function hkdfAesKey(base: CryptoKey, info: string, salt: Uint8Array = EMPTY_SALT): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(salt), info: utf8(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** HKDF-SHA256 from a base key → a non-extractable HMAC-SHA256 key. */
export function hkdfHmacKey(base: CryptoKey, info: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: utf8(info) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/** Imports raw key material as a non-extractable AES-256-GCM key. */
export function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", concat(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export interface AccountKeys {
  /** Sent to the server as the sign-in credential. */
  authKey: Bytes;
  /** Wraps the E2EE data key; never leaves the browser. */
  wrapKey: CryptoKey;
}

/** password → { authKey, wrapKey } (docs/e2ee-spec.md §1). */
export async function deriveAccountKeys(password: string, params: KdfParams): Promise<AccountKeys> {
  const master = await deriveMasterSecret(password, params);
  try {
    const authKey = await hkdfBytes(master, "maple-notes/v2/auth");
    const wrapBytes = await hkdfBytes(master, "maple-notes/v2/wrap");
    const wrapKey = await importAesKey(wrapBytes);
    wrapBytes.fill(0);
    return { authKey, wrapKey };
  } finally {
    master.fill(0);
  }
}
