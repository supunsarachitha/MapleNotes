import { randomBytes, type Bytes } from "./encoding";
import { hkdfBytes, importAesKey } from "./kdf";

// Recovery key (docs/e2ee-spec.md §6): 32 random bytes shown once as 13 groups of 4 Crockford Base32 characters.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A new random recovery key. */
export function generateRecoveryKey(): Bytes {
  return randomBytes(32);
}

/** 32 bytes → "7K3M-…" (52 characters in groups of 4). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("A recovery key is 32 bytes.");
  let buffer = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

/** Parses a typed recovery key, tolerating case, spaces, dashes and the look-alikes O/0 and I/L/1. */
export function parseRecoveryKey(text: string): Bytes {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 52) throw new Error("A recovery key has 52 characters.");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("This is not a valid recovery key.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
    buffer &= (1 << bits) - 1;
  }
  if (out.length !== 32 || buffer !== 0) throw new Error("This is not a valid recovery key.");
  return new Uint8Array(out);
}

export interface RecoveryKeys {
  /** Wraps the data key (second copy). */
  wrapKey: CryptoKey;
  /** Proves knowledge of the recovery key to the server. */
  authKey: Bytes;
}

/** recoveryKey → { wrapKey, authKey }. */
export async function deriveRecoveryKeys(recoveryKey: Uint8Array): Promise<RecoveryKeys> {
  const wrapBytes = await hkdfBytes(recoveryKey, "maple-notes/v2/recovery/wrap");
  const wrapKey = await importAesKey(wrapBytes);
  wrapBytes.fill(0);
  return { wrapKey, authKey: await hkdfBytes(recoveryKey, "maple-notes/v2/recovery/auth") };
}
