import { concat, utf8, type Bytes } from "./encoding";

// HKDF-SHA256 helpers (docs/e2ee-spec.md, "Conventions"). Kept apart from kdf.ts, which starts the Argon2id worker, so
// that the media service worker can derive keys without bundling the password code.

const EMPTY_SALT = new Uint8Array(0);

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
