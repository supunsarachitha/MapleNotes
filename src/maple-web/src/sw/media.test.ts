// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { encryptAttachment } from "../crypto/attachments";
import { encryptMetadata } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64, type Bytes } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { parseRange, serveAttachment, type MediaDeps, type Opened } from "./media";

const userId = v.ids.userId;
const id = v.ids.attachmentId;
let keys: DataKeys;

function pattern(length: number): Bytes {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 251;
  return bytes;
}

/** Byte-wise equality; much faster than a deep equality check for megabytes. */
function same(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));
}

/** A stand-in for the attachment API: the info endpoint and HTTP Range over the ciphertext. */
async function fakeServer(plaintext: Bytes, metadata: { name: string; type: string } | null) {
  const ciphertext = new Uint8Array(await (await encryptAttachment(keys, userId, id, new Blob([plaintext]))).arrayBuffer());
  const encryptedMetadata = metadata
    ? toBase64(await encryptMetadata(keys, userId, id, { ...metadata, size: plaintext.length }))
    : null;
  const requests: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("Range");
    requests.push(`${input}${range ? ` ${range}` : ""}`);
    if (input.endsWith("/info")) return Response.json({ id, encryptedMetadata });
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range ?? "")!.map(Number);
    return new Response(ciphertext.slice(start, end! + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${ciphertext.length}` },
    });
  };
  return { ciphertext, requests, fetch };
}

function deps(server: { fetch: MediaDeps["fetch"] }, locked = false, cache = new Map<string, Promise<Opened>>()): MediaDeps {
  return { fetch: server.fetch, unlocked: async () => (locked ? null : { userId, keys }), cache };
}

function get(path: string, range?: string): Request {
  return new Request(`http://localhost${path}`, { headers: range ? { Range: range } : {} });
}

const url = `/e2ee/attachments/${id}`;

describe("media service worker", () => {
  beforeAll(async () => {
    keys = await importDataKey(fromBase64(v.dataKeyB64));
  });

  it("parses single byte ranges the way RFC 9110 describes", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull(); // several ranges: the whole file is fine
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=5-2", 1000)).toBe("invalid");
    expect(parseRange("bytes=-0", 1000)).toBe("invalid");
  });

  it("streams a whole file decrypted, with the headers of a passive inline image", async () => {
    const plaintext = pattern(200_000);
    const server = await fakeServer(plaintext, { name: "sunset.png", type: "image/png" });

    const response = await serveAttachment(get(url), deps(server));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''sunset.png");
    expect(response.headers.get("Content-Length")).toBe("200000");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(plaintext);
  });

  it("answers a range across a chunk boundary by fetching only those chunks", async () => {
    const plaintext = pattern(200_000);
    const server = await fakeServer(plaintext, { name: "clip.mp4", type: "video/mp4" });

    const response = await serveAttachment(get(url, "bytes=65530-65545"), deps(server));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 65530-65545/200000");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(plaintext.slice(65530, 65546));
    expect(server.requests.at(-1)).toBe(`/api/v1/attachments/${id} bytes=42-${42 + 2 * 65552 - 1}`); // chunks 0 and 1
  });

  it("sends at most 4 MiB for an open-ended range, as media elements ask for more", async () => {
    const plaintext = pattern(5 * 1024 * 1024);
    const server = await fakeServer(plaintext, { name: "long.webm", type: "video/webm" });

    const response = await serveAttachment(get(url, "bytes=1000-"), deps(server));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 1000-${1000 + 4 * 1024 * 1024 - 1}/${plaintext.length}`);
    expect(same(new Uint8Array(await response.arrayBuffer()), plaintext.subarray(1000, 1000 + 4 * 1024 * 1024))).toBe(true);
  }, 30_000);

  it("never serves a type that could run in the page inline", async () => {
    const server = await fakeServer(pattern(10), { name: 'evil "page".html', type: "text/html" });

    const page = await serveAttachment(get(url), deps(server));
    const forced = await serveAttachment(get(`${url}?download=1`), deps(await fakeServer(pattern(10), { name: "a.png", type: "image/png" })));

    expect(page.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(page.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''evil%20%22page%22.html");
    expect(forced.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("refuses when locked, for unknown or plain files, and for ranges it cannot satisfy", async () => {
    const server = await fakeServer(pattern(10), { name: "a.png", type: "image/png" });

    expect((await serveAttachment(get(url), deps(server, true))).status).toBe(403);
    expect((await serveAttachment(get("/e2ee/attachments/not-an-id"), deps(server))).status).toBe(404);
    expect((await serveAttachment(get(url), deps(await fakeServer(pattern(10), null)))).status).toBe(404);
    const unsatisfiable = await serveAttachment(get(url, "bytes=50-60"), deps(server));
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("reuses what it learned about a file for the next range request", async () => {
    const server = await fakeServer(pattern(200_000), { name: "clip.mp4", type: "video/mp4" });
    const shared = deps(server);

    await serveAttachment(get(url, "bytes=0-99"), shared);
    await serveAttachment(get(url, "bytes=100000-100099"), shared);

    expect(server.requests.filter((r) => r.endsWith("/info"))).toHaveLength(1);
  });

  it("fails a range whose ciphertext was tampered with", async () => {
    const server = await fakeServer(pattern(1_000), { name: "a.png", type: "image/png" });
    server.ciphertext[100] = server.ciphertext[100]! ^ 1;

    expect((await serveAttachment(get(url, "bytes=0-10"), deps(server))).status).toBe(502);
  });
});
