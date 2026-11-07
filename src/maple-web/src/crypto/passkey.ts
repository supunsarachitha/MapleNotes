import { utf8, uuidN, type Bytes } from "./encoding";
import { hkdfBytes, importAesKey } from "./hkdf";

// Unlocking end-to-end notes with a passkey (docs/e2ee-spec.md §6a). The passkey's PRF extension returns 32 secret
// bytes that only that passkey can produce, for a fixed salt; they never leave the browser. The data key is wrapped
// with a key derived from them, so the server stores one more wrapped copy that only the passkey opens.

/** The salt every passkey's PRF is evaluated with. Each passkey's own secret makes its output unique. */
export const PASSKEY_PRF_SALT: Bytes = utf8("maple-notes/v2/passkey/prf");

/** The AES key that wraps the data key for one passkey, from its PRF output. */
export async function passkeyWrapKey(prfOutput: Uint8Array): Promise<CryptoKey> {
  const raw = await hkdfBytes(prfOutput, "maple-notes/v2/passkey/wrap");
  try {
    return await importAesKey(raw);
  } finally {
    raw.fill(0);
  }
}

/** The envelope context of the data key wrapped for a passkey: the account and the passkey's row ID. */
export const passkeyContext = (userId: string, passkeyId: string) => `maple-notes/v2/e2ee/passkey/${uuidN(userId)}/${uuidN(passkeyId)}`;
