// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptNote, tagToken } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { api, refreshAntiforgeryToken } from "./api";
import { setContentSession } from "./noteCrypto";

// The API client for an account with end-to-end notes: what it sends, and how it searches, since the server cannot.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const userId = v.ids.userId;
let keys: DataKeys;

async function note(id: string, text: string) {
  return {
    id,
    content: null,
    encryptedContent: toBase64(await encryptNote(keys, userId, id, text)),
    isPinned: false,
    isArchived: false,
    createdAtUtc: "2026-09-29T10:00:00Z",
    updatedAtUtc: "2026-09-29T10:00:00Z",
    tags: [],
    attachments: [],
  };
}

describe("api client with end-to-end notes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    keys = await importDataKey(fromBase64(v.dataKeyB64));
    setContentSession({ userId, mode: "EndToEnd", keys });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockClear();
  });

  function url(call: number): URL {
    return new URL(fetchMock.mock.calls[call]?.[0] as string, "http://localhost");
  }

  it("creates notes without sending their text", async () => {
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { id: string };
      return json(await note(body.id, "Secret plan #launch"), 201);
    });

    const created = await api.createNote("Secret plan #launch", []);

    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("content");
    expect(JSON.stringify(sent)).not.toContain("Secret");
    expect(created).toMatchObject({ content: "Secret plan #launch", tags: ["launch"] });
  });

  it("filters by tag with the tokens of the tag and its nested tags", async () => {
    fetchMock.mockResolvedValueOnce(json([{ name: "work/meetings", noteCount: 1 }])).mockResolvedValueOnce(json({ items: [], nextCursor: null }));

    await api.listTags();
    await api.listNotes({ state: "active", tag: "work" });

    const params = url(1).searchParams;
    expect(params.get("tag")).toBe("work");
    expect(params.getAll("tagToken")).toEqual([await tagToken(keys, "work"), await tagToken(keys, "work/meetings")]);
  });

  it("loads the tag list before a first tag filter, to include nested tags", async () => {
    setContentSession({ userId: "0192f3a1-0000-7000-8000-00000000000a", mode: "EndToEnd", keys }); // nothing known yet
    fetchMock.mockResolvedValueOnce(json([{ name: "home/garden", noteCount: 2 }])).mockResolvedValueOnce(json({ items: [], nextCursor: null }));

    await api.listNotes({ state: "active", tag: "home" });

    expect(url(0).pathname).toBe("/api/v1/tags");
    expect(url(1).searchParams.getAll("tagToken")).toEqual([await tagToken(keys, "home"), await tagToken(keys, "home/garden")]);
  });

  it("searches end-to-end notes in the browser, page by page", async () => {
    const ids = ["0192f3a2-0000-7000-8000-000000000001", "0192f3a2-0000-7000-8000-000000000002", "0192f3a2-0000-7000-8000-000000000003"];
    fetchMock
      .mockResolvedValueOnce(json({ items: [await note(ids[0]!, "Nothing here"), await note(ids[1]!, "Maple SYRUP recipe")], nextCursor: "c1" }))
      .mockResolvedValueOnce(json({ items: [await note(ids[2]!, "More syrup")], nextCursor: null }));

    const page = await api.listNotes({ state: "active", q: "syrup", limit: 20 });

    expect(page.items.map((n) => n.id)).toEqual([ids[1], ids[2]]);
    expect(page.nextCursor).toBeNull();
    expect(url(0).searchParams.has("q")).toBe(false); // the server never sees the search
    expect(url(0).searchParams.get("limit")).toBe("100");
    expect(url(1).searchParams.get("cursor")).toBe("c1");
  });
});
