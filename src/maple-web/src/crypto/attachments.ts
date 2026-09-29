import type { DataKeys } from "./datakey";
import { concat, randomBytes, utf8, uuidN, type Bytes } from "./encoding";
import { DecryptionError } from "./envelope";
import { hkdfAesKey } from "./hkdf";

// End-to-end encrypted attachments (docs/e2ee-spec.md §5): the chunked AES-256-GCM format used by the server,
// with the file key derived from the E2EE data key. Decryption is random-access, so a service worker can serve
// byte ranges (video seeking) by decrypting only the chunks a request touches.

export const CHUNK_SIZE = 64 * 1024;
export const HEADER_SIZE = 42;
const TAG_SIZE = 16;
const SALT_SIZE = 32;
const MAGIC = utf8("MNAE");
const FORMAT_VERSION = 1;
const FILE_KEY_INFO = "maple-notes/v2/e2ee/attachment";

export const attachmentContext = (userId: string, attachmentId: string) =>
  `maple-notes/v2/e2ee/attachment/${uuidN(userId)}/${uuidN(attachmentId)}`;

function nonceFor(index: number, isFinal: boolean): Bytes {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(7, index);
  nonce[11] = isFinal ? 1 : 0;
  return nonce;
}

function fileKey(keys: DataKeys, salt: Uint8Array): Promise<CryptoKey> {
  return hkdfAesKey(keys.base, FILE_KEY_INFO, salt);
}

/** Encrypts a file chunk by chunk. The result is a Blob built from the encrypted chunks. */
export async function encryptAttachment(
  keys: DataKeys,
  userId: string,
  attachmentId: string,
  data: Blob,
  options: { salt?: Uint8Array; onProgress?: (fraction: number) => void } = {},
): Promise<Blob> {
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC, 0);
  header[4] = FORMAT_VERSION;
  header[5] = keys.version;
  new DataView(header.buffer).setUint32(6, CHUNK_SIZE);
  header.set(options.salt ?? randomBytes(SALT_SIZE), 10);

  const key = await fileKey(keys, header.subarray(10, HEADER_SIZE));
  const aad = concat(header, utf8(attachmentContext(userId, attachmentId)));
  const chunks = Math.max(1, Math.ceil(data.size / CHUNK_SIZE));
  const parts: BlobPart[] = [header];
  for (let index = 0; index < chunks; index++) {
    const plain = new Uint8Array(await data.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).arrayBuffer());
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonceFor(index, index === chunks - 1), additionalData: aad, tagLength: 128 },
      key,
      plain,
    );
    parts.push(new Uint8Array(sealed));
    options.onProgress?.((index + 1) / chunks);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

/** Random-access decryption of one encrypted attachment. */
export class AttachmentDecryptor {
  private constructor(
    private readonly key: CryptoKey,
    private readonly aad: Bytes,
    readonly chunkSize: number,
    readonly chunkCount: number,
    private readonly lastChunkCipherLength: number,
    /** Plaintext size. */
    readonly size: number,
  ) {}

  /** Validates the 42-byte header of a file of `encryptedSize` bytes and prepares its key. */
  static async create(
    keys: DataKeys,
    userId: string,
    attachmentId: string,
    header: Uint8Array,
    encryptedSize: number,
  ): Promise<AttachmentDecryptor> {
    if (header.length < HEADER_SIZE || MAGIC.some((byte, i) => header[i] !== byte)) {
      throw new DecryptionError("This is not an encrypted Maple Notes attachment.");
    }
    if (header[4] !== FORMAT_VERSION) throw new DecryptionError(`Unsupported attachment format ${header[4]}.`);
    if (header[5] !== keys.version) throw new DecryptionError("The attachment was encrypted with a different key.");
    const chunkSize = new DataView(header.buffer, header.byteOffset, HEADER_SIZE).getUint32(6);
    if (chunkSize < 1024 || chunkSize > 16 * 1024 * 1024) throw new DecryptionError("The attachment header is invalid.");

    const body = encryptedSize - HEADER_SIZE;
    const stride = chunkSize + TAG_SIZE;
    if (body < TAG_SIZE) throw new DecryptionError("The attachment is truncated.");
    const chunkCount = Math.ceil(body / stride);
    const lastChunkCipherLength = body - (chunkCount - 1) * stride;
    if (lastChunkCipherLength < TAG_SIZE) throw new DecryptionError("The attachment is truncated.");

    const headerBytes = concat(header.subarray(0, HEADER_SIZE));
    const key = await fileKey(keys, headerBytes.subarray(10, HEADER_SIZE));
    const aad = concat(headerBytes, utf8(attachmentContext(userId, attachmentId)));
    const size = (chunkCount - 1) * chunkSize + (lastChunkCipherLength - TAG_SIZE);
    return new AttachmentDecryptor(key, aad, chunkSize, chunkCount, lastChunkCipherLength, size);
  }

  /** Index of the chunk holding plaintext byte `offset`. */
  chunkOf(offset: number): number {
    return Math.min(this.chunkCount - 1, Math.floor(offset / this.chunkSize));
  }

  /** Byte range [start, end) of the encrypted file that holds chunks first..last. */
  cipherRange(first: number, last: number): { start: number; end: number } {
    const stride = this.chunkSize + TAG_SIZE;
    const start = HEADER_SIZE + first * stride;
    const end =
      last === this.chunkCount - 1
        ? HEADER_SIZE + last * stride + this.lastChunkCipherLength
        : HEADER_SIZE + (last + 1) * stride;
    return { start, end };
  }

  /** Decrypts consecutive chunks starting at `first` from their concatenated ciphertext. */
  async decryptChunks(first: number, ciphertext: Uint8Array): Promise<Bytes> {
    const stride = this.chunkSize + TAG_SIZE;
    const parts: Bytes[] = [];
    for (let offset = 0, index = first; offset < ciphertext.length; offset += stride, index++) {
      const isFinal = index === this.chunkCount - 1;
      const piece = ciphertext.subarray(offset, Math.min(ciphertext.length, offset + stride));
      try {
        parts.push(
          new Uint8Array(
            await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: nonceFor(index, isFinal), additionalData: this.aad, tagLength: 128 },
              this.key,
              concat(piece),
            ),
          ),
        );
      } catch {
        throw new DecryptionError("The attachment is damaged or was modified.");
      }
    }
    return concat(...parts);
  }
}

/** Decrypts a whole encrypted attachment (used when the service worker is unavailable). */
export async function decryptAttachment(
  keys: DataKeys,
  userId: string,
  attachmentId: string,
  encrypted: Blob,
  type = "application/octet-stream",
): Promise<Blob> {
  const header = new Uint8Array(await encrypted.slice(0, HEADER_SIZE).arrayBuffer());
  const decryptor = await AttachmentDecryptor.create(keys, userId, attachmentId, header, encrypted.size);
  const parts: BlobPart[] = [];
  const batch = 16; // chunks per read: 1 MiB at a time
  for (let first = 0; first < decryptor.chunkCount; first += batch) {
    const last = Math.min(decryptor.chunkCount - 1, first + batch - 1);
    const range = decryptor.cipherRange(first, last);
    parts.push(await decryptor.decryptChunks(first, new Uint8Array(await encrypted.slice(range.start, range.end).arrayBuffer())));
  }
  return new Blob(parts, { type });
}
