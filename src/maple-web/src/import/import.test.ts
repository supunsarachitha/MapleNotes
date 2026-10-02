import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { fromBase64, fromUtf8 } from "../crypto/encoding";
import vectors from "../export/export-vectors.json";
import { safeFileName } from "../export/naming";
import { ApiError } from "../lib/apiError";
import type { Attachment, Label, Note } from "../lib/types";
import { runImport } from "./importer";
import { readImport, type ImportItem } from "./parse";
import { readZip } from "./zip";

// Round trip: the server's own export archives (export-vectors.json, every format and layout) must restore into
// exactly the notes that were exported, with their IDs, dates, state, kinds, daily dates, labels and files.

const notes = [...vectors.active.items, ...vectors.archived.items] as unknown as Array<Note & { attachments: Attachment[] }>;
const files = vectors.files as Record<string, string>;
const labelNames = new Map((vectors.labels as Label[]).map((label) => [label.id, label.name] as const));

function archive(entries: Record<string, string>, name = "maple-notes.zip"): File {
  const zippable: Zippable = {};
  for (const [path, text] of Object.entries(entries)) {
    const value = path === "manifest.json" ? text.replace("EXPORTED_AT", "2025-09-01T10:00:00+02:00") : text;
    zippable[path] = [value.startsWith("base64:") ? fromBase64(value.slice(7)) : strToU8(value), { level: path.endsWith(".png") ? 0 : 6 }];
  }
  return new File([zipSync(zippable)], name);
}

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) * 1000;

describe("reading ZIP archives", () => {
  it("reads stored and deflated entries, skipping folders", async () => {
    const zip = new File([zipSync({ "a.txt": strToU8("hello"), "dir/": new Uint8Array(0), "dir/b.bin": [new Uint8Array([1, 2, 3]), { level: 0 }] })], "x.zip");

    const entries = await readZip(zip);

    expect(entries.map((e) => [e.name, e.size])).toEqual([["a.txt", 5], ["dir/b.bin", 3]]);
    expect(fromUtf8(await entries[0]!.read())).toBe("hello");
    expect([...(await entries[1]!.read())]).toEqual([1, 2, 3]);
  });

  it("refuses files that are not archives", async () => {
    await expect(readZip(new File(["not a zip"], "x.zip"))).rejects.toThrow("This is not a ZIP archive.");
  });
});

describe("restoring an export", () => {
  it.each(vectors.exports.map((e) => [e.query, e.entries as unknown as Record<string, string>] as const))("restores every note of %s", async (query, entries) => {
    const format = new URLSearchParams(query).get("format")!;
    const withFiles = !query.includes("includeAttachments=false");
    const manifest = JSON.parse(entries["manifest.json"]!) as { notes: Array<{ id: string }>; labels: Array<{ name: string; color: string }> };

    const plan = await readImport([archive(entries)]);

    expect(plan.problems).toEqual([]);
    expect(plan.items.map((i) => i.id)).toEqual(manifest.notes.map((n) => n.id));
    expect(Object.fromEntries(plan.labelColors)).toEqual(Object.fromEntries(manifest.labels.map((l) => [l.name.toLowerCase(), l.color])));
    expect(manifest.labels.map((l) => l.name)).not.toContain("Unused"); // only the labels the exported notes carry
    for (const item of plan.items) {
      const note = notes.find((n) => n.id === item.id)!;
      const edited = new Date(note.updatedAtUtc).getTime() - new Date(note.createdAtUtc).getTime() > 60_000;
      expect(item.content).toBe(format === "json" ? note.content : note.content.trimEnd());
      expect(item.createdAt.getTime()).toBe(seconds(note.createdAtUtc));
      expect(item.updatedAt.getTime()).toBe(format === "txt" && !edited ? seconds(note.createdAtUtc) : seconds(note.updatedAtUtc));
      expect([item.pinned, item.archived, item.kind, item.dailyDate]).toEqual([note.isPinned, note.isArchived, note.kind, note.dailyDate ?? null]);
      expect([...item.labels].sort()).toEqual((note.labelIds ?? []).map((id) => labelNames.get(id)!).sort());
      expect(item.missing).toEqual([]);
      const expected = withFiles ? note.attachments : [];
      expect(item.attachments.map((a) => a.name)).toEqual(expected.map((a) => (format === "txt" ? safeFileName(a.fileName) : a.fileName)));
      if (format === "json") expect(item.attachments.map((a) => a.type)).toEqual(expected.map((a) => a.contentType));
      for (const [i, attachment] of item.attachments.entries()) {
        expect([...(await attachment.read())]).toEqual([...fromBase64(files[expected[i]!.id]!)]);
      }
    }
  });

  it("reads single note files and archives without a manifest", async () => {
    const markdown = new File(["# Plain notes\n\nFrom another app"], "ideas.md", { lastModified: Date.UTC(2025, 0, 2) });
    const text = new File(["just text"], "todo.txt", { lastModified: Date.UTC(2025, 0, 3) });
    const folder = new File([zipSync({ "notes/a.md": strToU8("A"), "notes/b.txt": strToU8("B"), "notes/photo.png": new Uint8Array([1]) })], "folder.zip");
    const other = new File(["{}"], "data.json");

    const plan = await readImport([markdown, text, folder, other, new File(["x"], "movie.mp4")]);

    expect(plan.items.map((i) => [i.source, i.content, i.id, i.kind])).toEqual([
      ["ideas.md", "# Plain notes\n\nFrom another app", null, "Note"],
      ["todo.txt", "just text", null, "Note"],
      ["notes/a.md", "A", null, "Note"],
      ["notes/b.txt", "B", null, "Note"],
    ]);
    expect(plan.items[0]!.createdAt.getTime()).toBe(Date.UTC(2025, 0, 2));
    expect(plan.problems).toEqual([
      "data.json: This JSON file is not a Maple Notes note.",
      "movie.mp4: choose .zip, .md, .txt or .json files.",
    ]);
  });
});

describe("running a restore", () => {
  const item = (id: string | null, attachments = 0, labels: string[] = []): ImportItem => ({
    source: `${id}.md`,
    id,
    content: "text",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    pinned: false,
    archived: false,
    kind: "Note",
    dailyDate: null,
    labels,
    attachments: Array.from({ length: attachments }, (_, i) => ({ name: `f${i}.png`, type: "image/png", size: 1, read: async () => new Uint8Array([i]) })),
    missing: [],
  });

  it("stops at the first note that does not fit in the storage limit", async () => {
    const full = new ApiError(507, { title: "There is not enough room in your storage.", detail: "Delete notes or files to make room, or ask an administrator for more space." });
    const api = {
      existingNotes: vi.fn(async () => []),
      importNote: vi.fn(async (note: { id: string | null }, _attachmentIds: string[]) => {
        if (note.id === "0192f3a2-0000-7000-8000-000000000002") throw full;
        return { imported: true, note: {} as Note };
      }),
      deleteAttachment: vi.fn(async () => undefined),
      labels: { list: vi.fn(async () => []), create: vi.fn() },
    };
    let next = 0;
    const upload = vi.fn(async () => ({ id: `upload-${++next}` }) as Attachment);

    const result = await runImport(
      [item("0192f3a2-0000-7000-8000-000000000001"), item("0192f3a2-0000-7000-8000-000000000002", 1), item("0192f3a2-0000-7000-8000-000000000003")],
      () => undefined,
      { api, upload },
    );

    expect(api.importNote).toHaveBeenCalledTimes(2); // the third note is not tried: it would not fit either
    expect(api.deleteAttachment).toHaveBeenCalledWith("upload-1"); // the file uploaded for the note that did not fit
    expect(result).toMatchObject({ total: 3, done: 1, imported: 1, failed: [], stopped: "There is not enough room in your storage. Delete notes or files to make room, or ask an administrator for more space." });
  });

  it("reuses labels of the same name, creates the others in their exported colour, and reports the ones it cannot", async () => {
    const work: Label = { id: "l-work", name: "Work", color: "Blue", noteCount: 3 };
    const api = {
      existingNotes: vi.fn(async () => ["0192f3a2-0000-7000-8000-000000000001"]),
      importNote: vi.fn(async (_note: { id: string | null }, _attachmentIds: string[], _labelIds?: string[]) => ({ imported: true, note: {} as Note })),
      deleteAttachment: vi.fn(async () => undefined),
      labels: {
        list: vi.fn(async () => [work, { id: "l-locked", name: "Encrypted label", color: "Grey", noteCount: 0, unreadable: true } as Label]),
        create: vi.fn(async (name: string, color: Label["color"]) => {
          if (name === "Too many") throw new ApiError(409, { title: "An account can have at most 100 labels." });
          return { id: `l-${name.toLowerCase()}`, name, color, noteCount: 0 };
        }),
      },
    };

    const result = await runImport(
      [
        item("0192f3a2-0000-7000-8000-000000000001", 0, ["Skipped"]), // the account has this note: its label is not needed
        item("0192f3a2-0000-7000-8000-000000000002", 0, [" work ", "Trip", "Too many"]),
        item(null, 0, ["trip", "Encrypted label"]),
      ],
      () => undefined,
      { api, upload: vi.fn() },
      new Map([["trip", "Teal"]]),
    );

    expect(api.labels.create.mock.calls).toEqual([
      ["Trip", "Teal"],
      ["Too many", expect.any(String)],
      ["Encrypted label", expect.any(String)], // an undecryptable label's placeholder is not a match
    ]);
    expect(api.importNote.mock.calls.map(([note, , labelIds]) => [note.id, labelIds])).toEqual([
      ["0192f3a2-0000-7000-8000-000000000002", ["l-work", "l-trip"]],
      [null, ["l-trip", "l-encrypted label"]],
    ]);
    expect(result).toMatchObject({
      imported: 2,
      skipped: 1,
      labels: 2,
      failed: [{ source: "Label “Too many”", reason: "An account can have at most 100 labels. Notes are restored without it." }],
    });
  });

  it("skips notes the account has, uploads files first, and reports failures", async () => {
    const api = {
      existingNotes: vi.fn(async () => ["0192f3a2-0000-7000-8000-000000000001"]),
      importNote: vi.fn(async (note: { id: string | null }, _attachmentIds: string[]) => {
        if (note.id === "bad") throw new Error("Write something or attach a file.");
        return { imported: true, note: {} as Note };
      }),
      deleteAttachment: vi.fn(async () => undefined),
      labels: { list: vi.fn(async () => []), create: vi.fn() },
    };
    let next = 0;
    const upload = vi.fn(async () => ({ id: `upload-${++next}` }) as Attachment);
    const updates: number[] = [];

    const result = await runImport(
      [item("0192f3a2-0000-7000-8000-000000000001", 1), item("0192f3a2-0000-7000-8000-000000000002", 2), item("bad", 1), item(null)],
      (p) => updates.push(p.done),
      { api, upload },
    );

    expect(api.existingNotes).toHaveBeenCalledWith(["0192f3a2-0000-7000-8000-000000000001", "0192f3a2-0000-7000-8000-000000000002", "bad"]);
    expect(api.importNote.mock.calls.map(([note, ids]) => [note.id, ids])).toEqual([
      ["0192f3a2-0000-7000-8000-000000000002", ["upload-1", "upload-2"]],
      ["bad", ["upload-3"]],
      [null, []],
    ]);
    expect(api.deleteAttachment).toHaveBeenCalledWith("upload-3"); // the failed note's file is removed again
    expect(result).toMatchObject({ total: 4, done: 4, imported: 2, skipped: 1, files: 2, failed: [{ source: "bad.md", reason: "Write something or attach a file." }] });
    expect(updates).toEqual([0, 1, 2, 3, 4]);
  });
});
