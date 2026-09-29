import { concat, type Bytes } from "./encoding";
import { hkdfBytes, importAesKey } from "./hkdf";
import { validateKdf, type KdfParams } from "./params";

// Password-derived keys and HKDF helpers (docs/e2ee-spec.md §1). The expensive Argon2id step runs in a Web Worker in
// the browser so the page stays responsive; where Workers are unavailable (tests) it runs inline.

export { DEFAULT_KDF, validateKdf, type KdfParams } from "./params";
export { hkdfAesKey, hkdfBytes, hkdfHmacKey, importAesKey } from "./hkdf";

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
  if (!target) {
    const { argon2Master } = await import("./argon2");
    return argon2Master(password, params);
  }
  const id = nextRequest++;
  return new Promise<Bytes>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, password, params: { ...params, salt: concat(params.salt) } });
  });
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
