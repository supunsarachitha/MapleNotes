import { concat, randomBytes, utf8, type Bytes } from "./encoding";

// AES-256-GCM envelope, byte-for-byte identical to the server's (docs/e2ee-spec.md §2):
// [0] format version | [1] key version | [2..13] nonce | [14..29] tag | [30..] ciphertext; AAD = [0..1] ‖ context.

const FORMAT_VERSION = 1;
const HEADER = 2;
const NONCE = 12;
const TAG = 16;
export const ENVELOPE_OVERHEAD = HEADER + NONCE + TAG;

/** Thrown when data cannot be decrypted: wrong key, wrong context, damage or tampering. */
export class DecryptionError extends Error {
  constructor(message = "The data could not be decrypted.") {
    super(message);
    this.name = "DecryptionError";
  }
}

/** Encrypts and authenticates `plaintext`, bound to `context`. */
export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  context: string,
  options: { keyVersion?: number; nonce?: Uint8Array } = {},
): Promise<Bytes> {
  const header = new Uint8Array([FORMAT_VERSION, options.keyVersion ?? 1]);
  const nonce = options.nonce ?? randomBytes(NONCE);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: concat(nonce), additionalData: concat(header, utf8(context)), tagLength: 128 },
      key,
      concat(plaintext),
    ),
  );
  // WebCrypto returns ciphertext ‖ tag; the envelope stores the tag first.
  return concat(header, nonce, sealed.subarray(sealed.length - TAG), sealed.subarray(0, sealed.length - TAG));
}

/** Verifies and decrypts an envelope produced by {@link seal} (or by the server's envelope code). */
export async function open(key: CryptoKey, envelope: Uint8Array, context: string): Promise<Bytes> {
  if (envelope.length < ENVELOPE_OVERHEAD) throw new DecryptionError("The encrypted data is truncated.");
  if (envelope[0] !== FORMAT_VERSION) throw new DecryptionError(`Unsupported encryption format ${envelope[0]}.`);
  const header = envelope.subarray(0, HEADER);
  const nonce = envelope.subarray(HEADER, HEADER + NONCE);
  const tag = envelope.subarray(HEADER + NONCE, ENVELOPE_OVERHEAD);
  const ciphertext = envelope.subarray(ENVELOPE_OVERHEAD);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: concat(nonce), additionalData: concat(header, utf8(context)), tagLength: 128 },
        key,
        concat(ciphertext, tag),
      ),
    );
  } catch {
    throw new DecryptionError();
  }
}
