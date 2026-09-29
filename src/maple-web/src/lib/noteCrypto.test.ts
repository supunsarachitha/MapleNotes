// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { decryptNote, decryptTagName, encryptNote, encryptTagName, tagToken } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { decodeNote, decodeTags, encodeNewNote, encodeNoteUpdate, setContentSession, tagFilterParams, UNREADABLE_NOTE } from "./noteCrypto";
import type { NoteWire } from "./types";

const userId = v.ids.userId;
let keys: DataKeys;

function wire(overrides: Partial<NoteWire>): NoteWire {
  return {
    id: v.ids.noteId,
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
});
