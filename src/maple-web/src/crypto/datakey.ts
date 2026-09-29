import { concat, randomBytes, uuidN, type Bytes } from "./encoding";
import { open, seal } from "./envelope";
import { hkdfAesKey, hkdfHmacKey } from "./kdf";

// The E2EE data key and its subkeys (docs/e2ee-spec.md §3). All CryptoKeys are non-extractable: page scripts can use
// them but can never read their bytes.

export const DATA_KEY_VERSION = 1;

export interface DataKeys {
  /** HKDF base key (derives per-file attachment keys). */
  base: CryptoKey;
  /** Encrypts note text. */
  note: CryptoKey;
  /** Encrypts attachment metadata and tag names. */
  metadata: CryptoKey;
  /** Computes blind tag tokens. */
  tagIndex: CryptoKey;
  version: number;
}

/** A new random 32-byte data key. */
export function generateDataKey(): Bytes {
  return randomBytes(32);
}

/** Imports raw data-key bytes and derives the subkeys. */
export async function importDataKey(raw: Uint8Array, version: number = DATA_KEY_VERSION): Promise<DataKeys> {
  const base = await crypto.subtle.importKey("raw", concat(raw), "HKDF", false, ["deriveKey"]);
  const [note, metadata, tagIndex] = await Promise.all([
    hkdfAesKey(base, "maple-notes/v2/e2ee/note"),
    hkdfAesKey(base, "maple-notes/v2/e2ee/metadata"),
    hkdfHmacKey(base, "maple-notes/v2/e2ee/tag-index"),
  ]);
  return { base, note, metadata, tagIndex, version };
}

export const dataKeyContext = (userId: string) => `maple-notes/v2/e2ee/data-key/${uuidN(userId)}`;
export const recoveryContext = (userId: string) => `maple-notes/v2/e2ee/recovery/${uuidN(userId)}`;

/** Wraps the data key under a key-wrapping key (password- or recovery-derived). */
export function wrapDataKey(wrappingKey: CryptoKey, raw: Uint8Array, context: string, nonce?: Uint8Array): Promise<Bytes> {
  return seal(wrappingKey, raw, context, { keyVersion: DATA_KEY_VERSION, nonce });
}

/** Unwraps a data key to its raw bytes, for re-wrapping it. The caller wipes `raw` when done. */
export async function unwrapRawDataKey(
  wrappingKey: CryptoKey,
  wrapped: Uint8Array,
  context: string,
): Promise<{ raw: Bytes; version: number }> {
  const raw = await open(wrappingKey, wrapped, context);
  if (raw.length !== 32) {
    raw.fill(0);
    throw new Error("The stored data key has an unexpected length.");
  }
  return { raw, version: wrapped[1] ?? DATA_KEY_VERSION };
}

/** Unwraps a data key and imports it; the raw bytes are wiped afterwards. */
export async function unwrapDataKey(wrappingKey: CryptoKey, wrapped: Uint8Array, context: string): Promise<DataKeys> {
  const { raw, version } = await unwrapRawDataKey(wrappingKey, wrapped, context);
  try {
    return await importDataKey(raw, version);
  } finally {
    raw.fill(0);
  }
}
