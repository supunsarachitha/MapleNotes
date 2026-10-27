// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { decryptAttachment } from "../crypto/attachments";
import {
  decryptMetadata,
  decryptMood,
  decryptNote,
  decryptTagName,
  encryptMetadata,
  encryptMood,
  encryptNote,
  encryptTagName,
  moodContext,
  tagToken,
} from "../crypto/content";
import { open } from "../crypto/envelope";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import {
  decodeAttachment,
  decodeNote,
  decodeTags,
  encodeImport,
  encodeNewNote,
  encodeNoteUpdate,
  encodeUpload,
  openMoodFromDevice,
  sealMoodForDevice,
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
      sticker: false,
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

  it("seals the sticker flag in the metadata of uploads, and reads it back only for pictures", async () => {
    const sticker = (await encodeUpload(new File([new Uint8Array([1])], "sun.webp", { type: "image/webp" }), true))!;
    const metadata = await decryptMetadata(keys, userId, sticker.id, fromBase64(sticker.metadata));
    const base = { sizeBytes: 1, isImage: false, url: "", createdAtUtc: "", fileName: null, contentType: null };
    const pdf = toBase64(await encryptMetadata(keys, userId, v.ids.attachmentId, { name: "a.pdf", type: "application/pdf", size: 1, sticker: true }));
    const old = toBase64(await encryptMetadata(keys, userId, v.ids.attachmentId, { name: "a.png", type: "image/png", size: 1 }));

    expect(metadata).toEqual({ name: "sun.webp", type: "image/webp", size: 1, sticker: true });
    expect(await decodeAttachment({ ...base, id: sticker.id, encryptedMetadata: sticker.metadata })).toMatchObject({ isSticker: true, isImage: true });
    expect(await decodeAttachment({ ...base, id: v.ids.attachmentId, encryptedMetadata: pdf })).toMatchObject({ isSticker: false });
    expect(await decodeAttachment({ ...base, id: v.ids.attachmentId, encryptedMetadata: old })).toMatchObject({ isSticker: false });
    expect(await decodeAttachment({ ...base, id: "x", fileName: "s.png", contentType: "image/png", isSticker: true })).toMatchObject({ isSticker: true });
  });

  it("pads every mood, none included, to the same length and binds it to the note", async () => {
    const lengths = new Set<number>();
    for (const mood of [null, "Awful", "Bad", "Okay", "Good", "Great"]) {
      const envelope = await encryptMood(keys, userId, v.ids.noteId, mood);
      lengths.add(envelope.length);
      const padded = new TextDecoder().decode(await open(keys.metadata, envelope, moodContext(userId, v.ids.noteId)));
      expect(padded).toBe((mood ?? "none").toLowerCase().padEnd(8, " "));
      expect(await decryptMood(keys, userId, v.ids.noteId, envelope)).toBe(mood?.toLowerCase() ?? null);
    }
    expect(lengths.size).toBe(1);
    const sealed = await encryptMood(keys, userId, v.ids.noteId, "Good");
    await expect(decryptMood(keys, userId, v.ids.attachmentId, sealed)).rejects.toThrow();
  });

  it("always sends an end-to-end note's mood encrypted, and none for kinds without moods", async () => {
    const withMood = await encodeNewNote("text", "Quick", "Good");
    const without = await encodeNewNote("text", "Note");
    const todo = await encodeNewNote("text", "Todo", "Good");
    const restored = await encodeImport(null, "text", false, "Note", "Great");
    const update = await encodeNoteUpdate(v.ids.noteId, "text", null);
    const keep = await encodeNoteUpdate(v.ids.noteId, "text");

    expect(withMood).not.toHaveProperty("mood");
    expect(await decryptMood(keys, userId, withMood.id!, fromBase64(withMood.encrypted!.mood!))).toBe("good");
    expect(await decryptMood(keys, userId, without.id!, fromBase64(without.encrypted!.mood!))).toBeNull();
    expect(todo.encrypted!.mood).toBeUndefined();
    expect(await decryptMood(keys, userId, restored.id!, fromBase64(restored.encrypted!.mood!))).toBe("great");
    expect(await decryptMood(keys, userId, v.ids.noteId, fromBase64(update.encrypted!.mood!))).toBeNull();
    expect(keep.encrypted!.mood).toBeUndefined();
  });

  it("sends a plain account's mood as it is, and None to take it off", async () => {
    setContentSession({ userId, mode: "AtRest", keys: null });

    expect(await encodeNewNote("hi", "Note", "Okay")).toEqual({ content: "hi", mood: "Okay" });
    expect(await encodeNewNote("hi", "Habit", "Okay")).toEqual({ content: "hi" });
    expect(await encodeImport("id-1", "hi", false, "Quick", "Bad")).toEqual({ id: "id-1", content: "hi", mood: "Bad" });
    expect(await encodeNoteUpdate("id-1", "hi", null)).toEqual({ content: "hi", mood: "None" });
    expect(await encodeNoteUpdate("id-1", "hi")).toEqual({ content: "hi" });
  });

  it("decrypts moods, showing none for one that does not open, and reads plain ones", async () => {
    const encryptedMood = toBase64(await encryptMood(keys, userId, v.ids.noteId, "Great"));
    const encryptedContent = toBase64(await encryptNote(keys, userId, v.ids.noteId, "text"));
    const foreign = toBase64(await encryptMood(keys, userId, v.ids.attachmentId, "Great"));

    const decoded = await decodeNote(wire({ encryptedContent, encryptedMood }));

    expect(decoded.mood).toBe("Great");
    expect(decoded).not.toHaveProperty("encryptedMood");
    expect((await decodeNote(wire({ encryptedContent, encryptedMood: foreign }))).mood).toBeNull();
    expect((await decodeNote(wire({ content: "plain", mood: "Bad" }))).mood).toBe("Bad");
    expect((await decodeNote(wire({ content: "plain" }))).mood).toBeNull();
  });

  it("keeps a mood on this device encrypted for an end-to-end key, plain otherwise", async () => {
    const sealed = await sealMoodForDevice(v.ids.noteId, "Okay");
    expect(sealed.mood).toBeUndefined();
    expect(await openMoodFromDevice(v.ids.noteId, sealed)).toBe("Okay");
    expect(await openMoodFromDevice(v.ids.noteId, await sealMoodForDevice(v.ids.noteId, null))).toBeNull();
    expect(await sealMoodForDevice(v.ids.noteId, undefined)).toEqual({});

    setContentSession({ userId, mode: "Off", keys: null });
    expect(await sealMoodForDevice(v.ids.noteId, "Bad")).toEqual({ mood: "Bad" });
    expect(await openMoodFromDevice(v.ids.noteId, sealed)).toBeUndefined(); // locked: not readable now
  });
});
