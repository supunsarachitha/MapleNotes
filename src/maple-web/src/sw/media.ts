import { AttachmentDecryptor, HEADER_SIZE } from "../crypto/attachments";
import { decryptMetadata, type AttachmentMetadata } from "../crypto/content";
import type { DataKeys } from "../crypto/datakey";
import { fromBase64 } from "../crypto/encoding";
import { ATTACHMENT_CSP, canDisplayInline, DOWNLOAD_CONTENT_TYPE } from "../lib/media";

// How the media service worker serves end-to-end files (docs/e2ee-spec.md §5). A request for
// /e2ee/attachments/{id} is answered by fetching only the encrypted chunks it needs from
// /api/v1/attachments/{id} (HTTP Range) and decrypting them, so images appear and video can seek without downloading
// and decrypting the whole file first. Kept free of worker globals so tests can drive it.

export const MEDIA_PREFIX = "/e2ee/attachments/";

/** Most plaintext bytes one response carries for a range; media elements ask again for the rest. */
const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/** Chunks decrypted per request when streaming a whole file. */
const BATCH_CHUNKS = 16;

export interface Unlocked {
  userId: string;
  keys: DataKeys;
}

export interface MediaDeps {
  /** Same-origin fetch that carries the session cookie. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The unlocked key, or null when this browser holds none. */
  unlocked: () => Promise<Unlocked | null>;
  /** Opened files, reused across the many range requests of one video. */
  cache?: Map<string, Promise<Opened>>;
}

export interface Opened {
  metadata: AttachmentMetadata;
  decryptor: AttachmentDecryptor;
  /** The stored version's URL, from the info; downloads are cached as immutable per version. */
  url: string;
}

class HttpStatus extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * Parses a single `bytes=start-end` range (RFC 9110) against a size: null when there is none or it is not a single
 * byte range (the whole file is then served, as the RFC allows), "invalid" when it cannot be satisfied.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return "invalid";
  const start = first === "" ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === "" || last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return start >= size || start > end || (first === "" && Number(last) === 0) ? "invalid" : { start, end };
}

/** `Content-Disposition` with the file name encoded for any language (RFC 6266 / 8187). */
function disposition(kind: "inline" | "attachment", name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename*=UTF-8''${encoded}`;
}

async function open(id: string, unlocked: Unlocked, deps: MediaDeps): Promise<Opened> {
  const info = await deps.fetch(`/api/v1/attachments/${id}/info`, { cache: "no-store" });
  if (!info.ok) throw new HttpStatus(info.status);
  const { encryptedMetadata, url } = (await info.json()) as { encryptedMetadata?: string | null; url: string };
  if (!encryptedMetadata) throw new HttpStatus(404); // not an end-to-end file: the page uses its normal URL
  const metadata = await decryptMetadata(unlocked.keys, unlocked.userId, id, fromBase64(encryptedMetadata));

  const head = await deps.fetch(url, { headers: { Range: `bytes=0-${HEADER_SIZE - 1}` } });
  if (head.status !== 206) throw new HttpStatus(head.ok ? 502 : head.status);
  const total = Number(/\/(\d+)$/.exec(head.headers.get("Content-Range") ?? "")?.[1]);
  const header = new Uint8Array(await head.arrayBuffer());
  return { metadata, url, decryptor: await AttachmentDecryptor.create(unlocked.keys, unlocked.userId, id, header, total) };
}

async function fetchChunks(opened: Opened, first: number, last: number, deps: MediaDeps): Promise<Uint8Array> {
  const range = opened.decryptor.cipherRange(first, last);
  const response = await deps.fetch(opened.url, { headers: { Range: `bytes=${range.start}-${range.end - 1}` } });
  if (response.status !== 206) throw new HttpStatus(response.ok ? 502 : response.status);
  return opened.decryptor.decryptChunks(first, new Uint8Array(await response.arrayBuffer()));
}

function streamWhole(opened: Opened, deps: MediaDeps): ReadableStream<Uint8Array> {
  const { decryptor } = opened;
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= decryptor.chunkCount) {
        controller.close();
        return;
      }
      const last = Math.min(decryptor.chunkCount - 1, next + BATCH_CHUNKS - 1);
      try {
        controller.enqueue(await fetchChunks(opened, next, last, deps));
        next = last + 1;
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** Answers a request for `/e2ee/attachments/{id}` with the decrypted file or the requested part of it. */
export async function serveAttachment(request: Request, deps: MediaDeps): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.slice(MEDIA_PREFIX.length);
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 404 });

  const unlocked = await deps.unlocked();
  if (!unlocked) return new Response("Unlock Maple Notes to see this file.", { status: 403 });

  const key = `${unlocked.userId}/${id}`;
  let opening = deps.cache?.get(key);
  if (!opening) {
    opening = open(id, unlocked, deps);
    deps.cache?.set(key, opening);
    opening.catch(() => deps.cache?.delete(key));
  }

  let opened: Opened;
  try {
    opened = await opening;
  } catch (error) {
    return new Response(null, { status: error instanceof HttpStatus ? error.status : 502 });
  }

  const { metadata, decryptor } = opened;
  const size = decryptor.size;
  const inline = url.searchParams.get("download") !== "1" && canDisplayInline(metadata.type);
  const headers = new Headers({
    "Content-Type": inline ? metadata.type : DOWNLOAD_CONTENT_TYPE,
    "Content-Disposition": disposition(inline ? "inline" : "attachment", metadata.name),
    "Content-Security-Policy": ATTACHMENT_CSP,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });

  const range = parseRange(request.headers.get("Range"), size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range === null) {
    headers.set("Content-Length", String(size));
    return new Response(size === 0 ? null : streamWhole(opened, deps), { status: 200, headers });
  }

  const end = Math.min(range.end, range.start + MAX_RANGE_BYTES - 1);
  try {
    const first = decryptor.chunkOf(range.start);
    const plain = await fetchChunks(opened, first, decryptor.chunkOf(end), deps);
    const offset = range.start - first * decryptor.chunkSize;
    const body = plain.slice(offset, offset + (end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${end}/${size}`);
    headers.set("Content-Length", String(body.length));
    return new Response(body, { status: 206, headers });
  } catch (error) {
    return new Response(null, { status: error instanceof HttpStatus ? error.status : 502 });
  }
}
