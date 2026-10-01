// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptAttachment, encryptAttachment } from "../crypto/attachments";
import { decryptLabelName, decryptMetadata, decryptNote, encryptLabelName, encryptMetadata, encryptNote, tagToken } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64, type Bytes } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { refreshAntiforgeryToken } from "./api";
import { convertNextBatch } from "./conversion";
import { setContentSession } from "./noteCrypto";

// The browser's side of converting to and from end-to-end encryption, against a stand-in server (the server's side is
// tested in ConversionTests.cs).

const userId = v.ids.userId;
const noteId = v.ids.noteId;
const fileId = v.ids.attachmentId;
let keys: DataKeys;

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("conversion to and from end-to-end encryption", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const sent: Record<string, RequestInit> = {};

  beforeEach(async () => {
    for (const url of Object.keys(sent)) delete sent[url];
    keys = await importDataKey(fromBase64(v.dataKeyB64));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockReset();
  });

  function serve(batch: unknown, file: Bytes) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/account/conversion?")) return json(batch);
      if (url === `/api/v1/attachments/${fileId}`) return new Response(new Blob([file]));
      sent[url] = init!;
      return json(null, 204);
    });
  }

  it("encrypts plain notes and files when entering", async () => {
    setContentSession({ userId, mode: "EndToEnd", keys });
    const photo = new Uint8Array([1, 2, 3, 4, 5]);
    serve(
      {
        mode: "EndToEnd",
        remaining: 2,
        notes: [{ id: noteId, content: "Dinner with #friends", encryptedContent: null, updatedAtUtc: "2026-09-29T10:00:00.1234567Z" }],
        attachments: [{ id: fileId, fileName: "photo.png", contentType: "image/png", sizeBytes: 5, encryptedMetadata: null }],
      },
      photo,
    );

    expect(await convertNextBatch()).toBe(2);

    const note = JSON.parse(sent[`/api/v1/account/conversion/notes/${noteId}`]!.body as string);
    expect(note.updatedAtUtc).toBe("2026-09-29T10:00:00.1234567Z");
    expect(note.content).toBeUndefined();
    expect(await decryptNote(keys, userId, noteId, fromBase64(note.encrypted.content))).toBe("Dinner with #friends");
    expect(note.encrypted.tags[0].token).toBe(await tagToken(keys, "friends"));
    const form = sent[`/api/v1/account/conversion/attachments/${fileId}`]!.body as FormData;
    expect(await decryptMetadata(keys, userId, fileId, fromBase64(form.get("metadata") as string))).toEqual({
      name: "photo.png",
      type: "image/png",
      size: 5,
    });
    const encrypted = form.get("file") as File;
    expect(new Uint8Array(await (await decryptAttachment(keys, userId, fileId, encrypted)).arrayBuffer())).toEqual(photo);
  });

  it("decrypts end-to-end notes and files when leaving", async () => {
    setContentSession({ userId, mode: "AtRest", keys });
    const photo = new Uint8Array([9, 8, 7]);
    const stored = new Uint8Array(await (await encryptAttachment(keys, userId, fileId, new Blob([photo]))).arrayBuffer());
    serve(
      {
        mode: "AtRest",
        remaining: 2,
        notes: [
          {
            id: noteId,
            content: null,
            encryptedContent: toBase64(await encryptNote(keys, userId, noteId, "Back to plain")),
            updatedAtUtc: "2026-09-29T10:00:00Z",
          },
        ],
        attachments: [
          {
            id: fileId,
            fileName: null,
            contentType: null,
            sizeBytes: stored.length,
            encryptedMetadata: toBase64(await encryptMetadata(keys, userId, fileId, { name: "clip.webm", type: "video/webm", size: 3 })),
          },
        ],
      },
      stored,
    );

    await convertNextBatch();

    expect(JSON.parse(sent[`/api/v1/account/conversion/notes/${noteId}`]!.body as string)).toEqual({
      updatedAtUtc: "2026-09-29T10:00:00Z",
      content: "Back to plain",
    });
    const file = (sent[`/api/v1/account/conversion/attachments/${fileId}`]!.body as FormData).get("file") as File;
    expect([file.name, file.type]).toEqual(["clip.webm", "video/webm"]);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(photo);
  });

  it("leaves damaged items alone and stops when nothing else can be converted", async () => {
    setContentSession({ userId, mode: "AtRest", keys });
    const damaged = await encryptNote(keys, userId, noteId, "x");
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1; // the last ciphertext byte
    serve(
      {
        mode: "AtRest",
        remaining: 1,
        notes: [{ id: noteId, content: null, encryptedContent: toBase64(damaged), updatedAtUtc: "2026-09-29T10:00:00Z" }],
        attachments: [],
      },
      new Uint8Array(),
    );

    expect(await convertNextBatch()).toBe(1); // tried once: nothing sent
    expect(await convertNextBatch()).toBe(0); // now known as damaged: nothing it can do
    expect(sent[`/api/v1/account/conversion/notes/${noteId}`]).toBeUndefined();
  });

  it("saves label names again in the new form, both ways", async () => {
    const labelId = v.ids.labelId;
    setContentSession({ userId, mode: "EndToEnd", keys });
    serve({ mode: "EndToEnd", remaining: 1, notes: [], attachments: [], labels: [{ id: labelId, name: "Quokka plans", encryptedName: null }] }, new Uint8Array());

    expect(await convertNextBatch()).toBe(1);
    const entering = JSON.parse(sent[`/api/v1/labels/${labelId}`]!.body as string) as { encryptedName: string };
    expect(sent[`/api/v1/labels/${labelId}`]!.method).toBe("PUT");
    expect(await decryptLabelName(keys, userId, labelId, fromBase64(entering.encryptedName))).toBe("Quokka plans");

    setContentSession({ userId, mode: "AtRest", keys });
    const encryptedName = toBase64(await encryptLabelName(keys, userId, labelId, "Quokka plans"));
    serve({ mode: "AtRest", remaining: 1, notes: [], attachments: [], labels: [{ id: labelId, name: null, encryptedName }] }, new Uint8Array());

    expect(await convertNextBatch()).toBe(1);
    expect(JSON.parse(sent[`/api/v1/labels/${labelId}`]!.body as string)).toEqual({ name: "Quokka plans" });
  });
});
