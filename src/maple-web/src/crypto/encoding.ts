// Byte and text helpers shared by the E2EE implementation (see docs/e2ee-spec.md).

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 bytes of a string. */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

/** Decodes UTF-8, rejecting invalid sequences. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Joins byte arrays into a new array. */
export function concat(...parts: Uint8Array[]): Bytes {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Cryptographically random bytes. */
export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decodes standard base64. */
export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64url without padding (used for tag tokens). */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lower-case hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A UUID in the 32-hex-digit form used inside encryption contexts. */
export function uuidN(uuid: string): string {
  const n = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(n)) throw new Error(`Not a UUID: ${uuid}`);
  return n;
}

/**
 * A new UUID version 7 (RFC 9562): 48-bit Unix time in milliseconds, then random bits. End-to-end encrypted items get
 * their ID in the browser because the ID is bound into their ciphertext.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
