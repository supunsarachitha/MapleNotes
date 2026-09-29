// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { decryptAttachment } from "../crypto/attachments";
import { decryptMetadata, decryptNote, decryptTagName, encryptMetadata, encryptNote, encryptTagName, tagToken } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import {
  decodeAttachment,
  decodeNote,
  decodeTags,
  encodeNewNote,
  encodeNoteUpdate,
  encodeUpload,
  setContentSession,
  tagFilterParams,
  UNREADABLE_NOTE,
} from "./noteCrypto";
import type { NoteWire } from "./types";

const userId = v.ids.userId;
let keys: DataKeys;

function wire(overrides: Partial<NoteWire>): NoteWire {
  return {
    id: v.ids.noteId,
    kind: "Note",
    content: null,
    isPinned: false,
    isArchived: false,
    createdAtUtc: "2026-09-29T10:00:00Z",
    updatedAtUtc: "2026-09-29T10:00:00Z",
    tags: [],
    attachments: [],
    ...overrides,
  };
}

describe("note encryption at the API boundary", () => {
  beforeEach(async () => {
    keys = await importDataKey(fromBase64(v.dataKeyB64));
    setContentSession({ userId, mode: "EndToEnd", keys });
  });

  it("sends new notes with an ID chosen here, encrypted text and blind tags", async () => {
    const fields = await encodeNewNote("Buy **maple** syrup #groceries #Work/Meetings");

    expect(fields.content).toBeUndefined();
    expect(fields.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await decryptNote(keys, userId, fields.id!, fromBase64(fields.encrypted!.content))).toBe(
      "Buy **maple** syrup #groceries #Work/Meetings",
    );
    const tags = fields.encrypted!.tags;
    expect(tags.map((t) => t.token)).toEqual([await tagToken(keys, "groceries"), await tagToken(keys, "work/meetings")]);
    expect(await decryptTagName(keys, userId, tags[1]!.token, fromBase64(tags[1]!.name))).toBe("work/meetings");
  });

  it("encrypts updates for the note's own ID", async () => {
    const fields = await encodeNoteUpdate(v.ids.noteId, "Edited");

    expect(await decryptNote(keys, userId, v.ids.noteId, fromBase64(fields.encrypted!.content))).toBe("Edited");
  });

  it("sends plain text for accounts that are not end-to-end", async () => {
    setContentSession({ userId, mode: "AtRest", keys: null });

    expect(await encodeNewNote("hello")).toEqual({ content: "hello" });
  });

  it("decrypts notes and reads their tags from the text", async () => {
    const encrypted = toBase64(await encryptNote(keys, userId, v.ids.noteId, "Plan #zeta and #alpha"));

    const note = await decodeNote(wire({ encryptedContent: encrypted }));
    const plain = await decodeNote(wire({ content: "server text", tags: ["x"] }));
    const damaged = await decodeNote(wire({ id: "0192f3a2-0000-7000-8000-000000000000", encryptedContent: encrypted }));

    expect(note).toMatchObject({ content: "Plan #zeta and #alpha", tags: ["alpha", "zeta"] });
    expect(note).not.toHaveProperty("encryptedContent");
    expect(plain).toMatchObject({ content: "server text", tags: ["x"] });
    expect(damaged.content).toBe(UNREADABLE_NOTE); // moved to another note: the ID is bound into the ciphertext
  });

  it("decrypts tag names, merges them with plain tags, and expands filters to nested tags", async () => {
    const token = await tagToken(keys, "work");
    const nestedToken = await tagToken(keys, "work/meetings");
    const name = async (t: string, n: string) => toBase64(await encryptTagName(keys, userId, t, n));

    const tags = await decodeTags([
      { name: "work", noteCount: 2 },
      { name: null, noteCount: 3, token, encryptedName: await name(token, "work") },
      { name: null, noteCount: 1, token: nestedToken, encryptedName: await name(nestedToken, "work/meetings") },
    ]);
    const filter = await tagFilterParams("#Work");

    expect(tags).toEqual([
      { name: "work", noteCount: 5 },
      { name: "work/meetings", noteCount: 1 },
    ]);
    expect(filter).toEqual({ tag: "#Work", tagToken: [token, nestedToken] }); // plain-text notes still use #work
  });

  it("never sends a tag name the server does not already know", async () => {
    const token = await tagToken(keys, "private");
    await decodeTags([{ name: null, noteCount: 1, token, encryptedName: toBase64(await encryptTagName(keys, userId, token, "private")) }]);

    expect(await tagFilterParams("private")).toEqual({ tagToken: [token] });
  });

  it("encrypts uploads under an ID chosen here, with their name, type and size sealed", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "holiday photo.png", { type: "image/png" });

    const upload = (await encodeUpload(file))!;

    const plain = new Uint8Array(await (await decryptAttachment(keys, userId, upload.id, upload.body)).arrayBuffer());
    expect(plain).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await decryptMetadata(keys, userId, upload.id, fromBase64(upload.metadata))).toEqual({
      name: "holiday photo.png",
      type: "image/png",
      size: 4,
    });
    setContentSession({ userId, mode: "Off", keys: null });
    expect(await encodeUpload(file)).toBeNull();
  });

  it("decrypts the name, type and size of end-to-end attachments", async () => {
    const id = v.ids.attachmentId;
    const encryptedMetadata = toBase64(await encryptMetadata(keys, userId, id, { name: "clip.mp4", type: "video/mp4", size: 1234 }));
    const base = { id, sizeBytes: 5000, isImage: false, url: `/api/v1/attachments/${id}`, createdAtUtc: "" };

    const decoded = await decodeAttachment({ ...base, fileName: null, contentType: null, encryptedMetadata });
    const plain = await decodeAttachment({ ...base, fileName: "a.png", contentType: "image/png", isImage: true });

    expect(decoded).toMatchObject({ fileName: "clip.mp4", contentType: "video/mp4", sizeBytes: 1234, isImage: false, endToEnd: true });
    expect(decoded).not.toHaveProperty("encryptedMetadata");
    expect(plain).toMatchObject({ fileName: "a.png", isImage: true });
    expect(plain.endToEnd).toBeUndefined();
  });
});
