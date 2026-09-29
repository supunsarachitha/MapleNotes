import { inflateSync } from "fflate";

// A small ZIP reader for restoring exports. It reads the archive's central directory from the end of the file and
// then one entry at a time (Blob.slice), so a large archive with big attachments is never held in memory whole.
// Supports stored and deflated entries and ZIP64 (large archives); that covers archives written by Maple Notes (.NET
// and fflate) and by common tools.

export interface ZipEntry {
  name: string;
  /** Size once extracted. */
  size: number;
  read(): Promise<Uint8Array>;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

const u64 = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

/** The largest entry this reader extracts; bigger ones are refused rather than exhausting memory. */
export const MAX_ENTRY_BYTES = 2 * 1024 ** 3;

/** Lists a ZIP archive's files (not its folders). */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  // The end-of-central-directory record is in the last 22 bytes, or before a comment of up to 64 KiB.
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await bytes(blob, tailStart, blob.size);
  let eocd = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--) {
    if (tail.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a ZIP archive.");

  let count = tail.getUint16(eocd + 10, true);
  let size = tail.getUint32(eocd + 12, true);
  let offset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    if (eocd < 20 || tail.getUint32(eocd - 20, true) !== ZIP64_LOCATOR) throw new Error("This ZIP archive is damaged.");
    const recordAt = u64(tail, eocd - 20 + 8);
    const record = await bytes(blob, recordAt, recordAt + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new Error("This ZIP archive is damaged.");
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  }

  const directory = await bytes(blob, offset, offset + size);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (directory.getUint32(at, true) !== CENTRAL) throw new Error("This ZIP archive is damaged.");
    const method = directory.getUint16(at + 10, true);
    let compressed = directory.getUint32(at + 20, true);
    let uncompressed = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let localAt = directory.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));

    // ZIP64 extra field: the 64-bit values of the fields that overflowed, in this order.
    for (let extra = at + 46 + nameLength; extra < at + 46 + nameLength + extraLength; ) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 1) {
        let field = extra + 4;
        if (uncompressed === 0xffffffff) (uncompressed = u64(directory, field)), (field += 8);
        if (compressed === 0xffffffff) (compressed = u64(directory, field)), (field += 8);
        if (localAt === 0xffffffff) localAt = u64(directory, field);
      }
      extra += 4 + length;
    }
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) throw new Error(`"${name}" uses a compression method this app cannot read.`);

    const [storedSize, start] = [compressed, localAt];
    entries.push({
      name,
      size: uncompressed,
      async read() {
        if (uncompressed > MAX_ENTRY_BYTES) throw new Error(`"${name}" is too large to restore.`);
        const header = await bytes(blob, start, start + 30);
        if (header.getUint32(0, true) !== LOCAL) throw new Error(`"${name}" is damaged.`);
        const dataAt = start + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const data = new Uint8Array(await blob.slice(dataAt, dataAt + storedSize).arrayBuffer());
        return method === 0 ? data : inflateSync(data, { out: new Uint8Array(uncompressed) });
      },
    });
  }
  return entries;
}
