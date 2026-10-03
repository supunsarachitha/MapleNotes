// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptNote } from "../crypto/content";
import { importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { api, outboxSender, refreshAntiforgeryToken } from "./api";
import { setContentSession } from "./noteCrypto";
import { forgetPendingChanges, keepEdit, pendingChanges, sendPendingChanges, setOutboxOwner, type Sender } from "./outbox";
import type { Note, NoteWire } from "./types";

// Writing offline: what is kept on the device when the server cannot be reached, how it shows in the lists, and how it
// is sent later without writing over a newer version.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const userId = v.ids.userId;
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function wire(id: string, content: string, updatedAtUtc = "2026-10-01T09:00:00.1234567Z"): NoteWire {
  return { id, kind: "Note", content, isPinned: false, isArchived: false, createdAtUtc: "2026-10-01T09:00:00Z", updatedAtUtc, tags: [], attachments: [] };
}

function body(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

/** Reads every byte the outbox stored, to check what an end-to-end account leaves on the device. */
async function rawOutbox(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("maple-notes-outbox", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const all = await new Promise<unknown[]>((resolve) => {
    const request = db.transaction("changes").objectStore("changes").getAll();
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return JSON.stringify(all);
}

describe("writing offline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setContentSession({ userId, mode: "AtRest", keys: null });
    setOutboxOwner({ userId, keepsNotes: true });
    await forgetPendingChanges();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockReset();
  });

  it("keeps a new note that cannot reach the server and shows it at the top of the timeline", async () => {
    fetchMock.mockImplementationOnce(offline);
    const created = await api.createNote("Written on the train #travel", []);

    expect(created).toMatchObject({ content: "Written on the train #travel", tags: ["travel"], pending: true, kind: "Note" });
    fetchMock.mockResolvedValueOnce(json({ items: [wire("0192f3a2-0000-7abc-8def-000000000001", "Older")], nextCursor: null }));
    const page = await api.listNotes({ state: "feed" });
    expect(page.items.map((note) => note.content)).toEqual(["Written on the train #travel", "Older"]);

    // Not in other kinds' lists, nor on later pages.
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    expect((await api.listNotes({ state: "feed", kinds: ["Todo"] })).items).toEqual([]);
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    expect((await api.listNotes({ state: "feed", cursor: "abc" })).items).toEqual([]);
  });

  it("keeps nothing for a session that does not keep notes on this device", async () => {
    setOutboxOwner({ userId, keepsNotes: false });
    fetchMock.mockImplementationOnce(offline);

    await expect(api.createNote("Lost", [])).rejects.toMatchObject({ status: 0 });
    expect(await pendingChanges()).toEqual([]);
  });

  it("keeps changes when a proxy answers for a server that is down, but not when the server refuses them", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "Bad gateway" }, 502));
    await api.createNote("Kept", []);
    fetchMock.mockResolvedValueOnce(json({ title: "Invalid" }, 400));
    await expect(api.createNote("", [])).rejects.toMatchObject({ status: 400 });

    expect((await pendingChanges()).length).toBe(1);
  });

  it("sends a new note with the ID and time it was written, once", async () => {
    fetchMock.mockImplementationOnce(offline);
    const created = await api.createNote("Offline thought", [], { kind: "Quick" });

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      json({ imported: true, note: wire(created.id, JSON.parse(init.body as string).content as string) }, 201),
    );
    const result = await sendPendingChanges(outboxSender);

    expect(result).toMatchObject({ sent: 1, copies: 0, failed: [] });
    const [url] = fetchMock.mock.calls[1] as [string]; // after the save that failed
    expect(url).toBe("/api/v1/notes/import");
    expect(body(fetchMock.mock.calls[1]!)).toMatchObject({ id: created.id, content: "Offline thought", kind: "Quick", createdAtUtc: created.createdAtUtc });
    expect(await pendingChanges()).toEqual([]);
  });

  it("sends an edit with the version it was made to, and shows it in the lists until then", async () => {
    const seen = await import("./noteCrypto").then(({ decodeNote }) => decodeNote(wire("0192f3a2-0000-7abc-8def-000000000002", "Before")));
    fetchMock.mockImplementationOnce(offline);
    const edited = await api.updateNote(seen.id, "After", [], seen);
    expect(edited).toMatchObject({ content: "After", pending: true, createdAtUtc: seen.createdAtUtc });
    expect(edited.updatedAtUtc > seen.updatedAtUtc).toBe(true);

    fetchMock.mockResolvedValueOnce(json({ items: [wire(seen.id, "Before")], nextCursor: null }));
    expect((await api.listNotes({ state: "feed" })).items[0]).toMatchObject({ content: "After", pending: true });

    fetchMock.mockResolvedValueOnce(json(wire(seen.id, "After", "2026-10-02T10:00:00Z")));
    expect(await sendPendingChanges(outboxSender)).toMatchObject({ sent: 1, copies: 0 });
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit]; // after the failed save and the list
    expect([url, init.method]).toEqual([`/api/v1/notes/${seen.id}`, "PUT"]);
    expect(body(fetchMock.mock.calls[2]!)).toMatchObject({ content: "After", expectedUpdatedAtUtc: "2026-10-01T09:00:00.1234567Z" });
    expect(await pendingChanges()).toEqual([]);
  });

  it("saves the offline text as a separate note when the note was edited elsewhere meanwhile", async () => {
    const seen = await import("./noteCrypto").then(({ decodeNote }) => decodeNote(wire("0192f3a2-0000-7abc-8def-000000000003", "Before")));
    await keepEdit(seen, "Mine, from the plane", []);

    fetchMock
      .mockResolvedValueOnce(json({ title: "This note changed since it was opened." }, 409))
      .mockResolvedValueOnce(json(wire(seen.id, "Theirs, from the laptop", "2026-10-02T10:00:00Z")))
      .mockResolvedValueOnce(json(wire("0192f3a2-0000-7abc-8def-000000000004", "Mine, from the plane"), 201));
    const result = await sendPendingChanges(outboxSender);

    expect(result).toMatchObject({ sent: 0, copies: 1, failed: [] });
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect([url, init.method]).toEqual(["/api/v1/notes", "POST"]);
    expect(body(fetchMock.mock.calls[2]!)).toMatchObject({ content: "Mine, from the plane" });
    expect(await pendingChanges()).toEqual([]);
  });

  it("makes no copy when the refused edit is already on the server (its first answer was lost)", async () => {
    const seen = await import("./noteCrypto").then(({ decodeNote }) => decodeNote(wire("0192f3a2-0000-7abc-8def-000000000005", "Before")));
    await keepEdit(seen, "After", []);

    fetchMock.mockResolvedValueOnce(json({ title: "Changed" }, 409)).mockResolvedValueOnce(json(wire(seen.id, "After", "2026-10-02T10:00:00Z")));
    expect(await sendPendingChanges(outboxSender)).toMatchObject({ copies: 0, failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await pendingChanges()).toEqual([]);
  });

  it("keeps the changes while the server still cannot be reached", async () => {
    fetchMock.mockImplementationOnce(offline);
    await api.createNote("Still waiting", []);

    fetchMock.mockImplementation(offline);
    expect(await sendPendingChanges(outboxSender)).toMatchObject({ sent: 0, stopped: true });
    expect((await pendingChanges()).length).toBe(1);
  });

  it("queues an edit of a note that is still waiting, so it goes out in order", async () => {
    fetchMock.mockImplementationOnce(offline);
    const created = await api.createNote("First draft", []);
    await api.updateNote(created.id, "Second draft", [], created); // no request: it joins the waiting note

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [entry] = await pendingChanges();
    expect(entry).toMatchObject({ type: "create", content: "Second draft", revision: 2 });
  });

  it("keeps an edit made while the note was being sent, as an edit of the version just saved", async () => {
    fetchMock.mockImplementationOnce(offline);
    const created = await api.createNote("One", []);
    const sender: Sender = {
      ...outboxSender,
      async create(entry) {
        await keepEdit(created, "Two", []); // typed while the first text was on its way
        return { ...created, pending: undefined, updatedAtUtc: "2026-10-02T10:00:00Z", content: "One", id: entry.noteId } as Note;
      },
    };

    await sendPendingChanges(sender);

    const [entry] = await pendingChanges();
    expect(entry).toMatchObject({ type: "update", content: "Two", baseUpdatedAtUtc: "2026-10-02T10:00:00Z" });
  });

  it("deletes another account's changes when someone else signs in, and everything on sign-out", async () => {
    fetchMock.mockImplementationOnce(offline);
    await api.createNote("Mine", []);

    setOutboxOwner({ userId: "0192f3a1-0000-7000-8000-000000000999", keepsNotes: true });
    await vi.waitFor(async () => expect(await rawOutbox()).toBe("[]"));

    setOutboxOwner({ userId, keepsNotes: true });
    fetchMock.mockImplementationOnce(offline);
    await api.createNote("Mine again", []);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(json({ token: "t", headerName: "X-XSRF-TOKEN" }));
    await api.logout();
    expect(await rawOutbox()).toBe("[]");
  });
});

describe("writing offline with end-to-end encryption", () => {
  let keys: DataKeys;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    keys = await importDataKey(fromBase64(v.dataKeyB64));
    setContentSession({ userId, mode: "EndToEnd", keys });
    setOutboxOwner({ userId, keepsNotes: true });
    await forgetPendingChanges();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockReset();
  });

  it("keeps the text encrypted on the device and sends it encrypted", async () => {
    fetchMock.mockImplementationOnce(offline);
    const created = await api.createNote("Secret plan #launch", []);
    expect(created).toMatchObject({ content: "Secret plan #launch", tags: ["launch"], pending: true });
    expect(await rawOutbox()).not.toMatch(/Secret|launch/);

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as { id: string };
      const note = { ...wire(sent.id, ""), content: null, encryptedContent: toBase64(await encryptNote(keys, userId, sent.id, "Secret plan #launch")) };
      return json({ imported: true, note }, 201);
    });
    expect(await sendPendingChanges(outboxSender)).toMatchObject({ sent: 1 });
    const sent = body(fetchMock.mock.calls[1]!);
    expect(sent).toMatchObject({ id: created.id });
    expect(sent).not.toHaveProperty("content");
    expect(JSON.stringify(sent)).not.toContain("Secret");
  });
});
