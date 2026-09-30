// @vitest-environment node
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { apiExportSource } from "./download";
import { concat, fromBase64, fromUtf8, toBase64 } from "../crypto/encoding";
import type { Attachment, Note } from "../lib/types";
import { buildExport, type ExportOptions, type ExportSource } from "./exporter";
import vectors from "./export-vectors.json";

// The browser export must reproduce the server's export entry by entry. export-vectors.json holds the server's own
// archives for a tricky dataset (time zones across a New Year and a daylight-saving change, slug collisions, Unicode,
// JSON escaping, awkward file names), written by ExportVectorTests.cs.

const notes = [...vectors.active.items, ...vectors.archived.items] as unknown as Note[];
const files = vectors.files as Record<string, string>;

const source: ExportSource = {
  account: vectors.account,
  notes: async (includeArchived) => notes.filter((note) => includeArchived || !note.isArchived),
  async *openAttachment(attachment: Attachment) {
    const bytes = fromBase64(files[attachment.id]!);
    yield bytes.subarray(0, 5); // in pieces, as downloads arrive
    yield bytes.subarray(5);
  },
};

function optionsFrom(query: string): ExportOptions {
  const params = new URLSearchParams(query);
  return {
    format: (params.get("format") ?? "md") as ExportOptions["format"],
    layout: (params.get("layout") ?? "month") as ExportOptions["layout"],
    includeArchived: params.get("includeArchived") === "true",
    includeAttachments: params.get("includeAttachments") !== "false",
    from: params.get("from"),
    to: params.get("to"),
    timeZone: params.get("timeZone") ?? "UTC",
  };
}

async function exportEntries(options: ExportOptions): Promise<Record<string, string>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of buildExport(source, options, new Date())) chunks.push(chunk);
  const entries: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(unzipSync(concat(...chunks)))) {
    const text = /\.(md|json)$/.test(path) || (path.endsWith(".txt") && !path.startsWith("attachments/"));
    entries[path] = text ? fromUtf8(bytes) : `base64:${toBase64(bytes)}`;
  }
  entries["manifest.json"] = entries["manifest.json"]!.replace(/"exportedAt": "[^"]+"/, '"exportedAt": "EXPORTED_AT"');
  return entries;
}

describe("browser export", () => {
  it.each(vectors.exports.map((e) => [e.query, e.entries] as const))("matches the server's archive for %s", async (query, expected) => {
    const entries = await exportEntries(optionsFrom(query));

    expect(Object.keys(entries)).toEqual(Object.keys(expected)); // same entries, in the same order
    for (const [path, content] of Object.entries(expected)) expect(entries[path], path).toBe(content);
  });

  it("lists files it could not read as problems instead of failing", async () => {
    const failing: ExportSource = {
      ...source,
      async *openAttachment(attachment) {
        if (attachment.fileName === "con.txt") throw new Error("gone");
        yield* source.openAttachment(attachment);
      },
    };
    const chunks: Uint8Array[] = [];
    const options = optionsFrom("format=md&layout=flat&includeArchived=true&timeZone=Europe%2FParis");
    for await (const chunk of buildExport(failing, options, new Date())) chunks.push(chunk);
    const manifest = JSON.parse(fromUtf8(unzipSync(concat(...chunks))["manifest.json"]!)) as { problems: string[]; attachmentCount: number };

    expect(manifest.problems).toEqual([expect.stringMatching(/_con\.txt: the stored file could not be read, so it was left out\.$/)]);
    expect(manifest.attachmentCount).toBe(4);
  });
});

describe("the account's notes for the browser export", () => {
  it("include todo lists and quick notes, active and archived", async () => {
    const list = vi.spyOn(api, "listNotes").mockResolvedValue({ items: [], nextCursor: null });

    await apiExportSource("maple").notes(true);

    expect(list.mock.calls.map(([params]) => [params.state, params.kinds])).toEqual([
      ["active", ["Note", "Todo", "Quick", "Habit"]],
      ["archived", ["Note", "Todo", "Quick", "Habit"]],
    ]);
    list.mockRestore();
  });
});
