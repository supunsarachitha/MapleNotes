// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, request, uploadAttachment } from "./api";
import { ApiError } from "./apiError";
import { closeNotebook, createNotebook, deleteNotebook, isNotebookOpen, notebookOnDevice, openNotebook } from "./deviceNotebook";
import { DEFAULT_PREFERENCES } from "./preferences";

// A notebook kept on the device answers the API itself, as the server would, and never contacts the server.

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await deleteNotebook();
  fetchSpy = vi.fn(() => Promise.reject(new TypeError("offline")));
  vi.stubGlobal("fetch", fetchSpy);
  await createNotebook({ displayName: "Field notes", appName: "Family Notes", preferences: DEFAULT_PREFERENCES });
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled(); // nothing ever reaches the server
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("A notebook on the device", () => {
  it("signs in as the notebook, with the app's name as the server last gave it", async () => {
    const status = await api.status();

    expect(status.onDevice).toBe(true);
    expect(status.user).toMatchObject({ displayName: "Field notes", encryptionMode: "Off", hasEndToEndKey: false, role: "User" });
    expect(status.branding).toEqual({ appName: "Family Notes", iconUrl: null });
    expect(status.linkPreviewsAvailable).toBe(false);
    expect(status.sessionPersistent).toBe(false);
  });

  it("keeps notes, newest first, with pinned ones listed apart and their tags found", async () => {
    const first = await api.createNote("First #work/meetings", []);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await api.createNote("Second #home", []);
    const pinned = await api.createNote("Pinned", [], { isPinned: true });

    expect((await api.listNotes({ state: "feed" })).items.map((n) => n.id)).toEqual([second.id, first.id]);
    expect((await api.listNotes({ state: "pinned" })).items.map((n) => n.id)).toEqual([pinned.id]);
    expect(first.tags).toEqual(["work/meetings"]);
    // A tag also finds the notes with its nested tags, as on the server.
    expect((await api.listNotes({ state: "active", tag: "work" })).items.map((n) => n.id)).toEqual([first.id]);
    expect((await api.listNotes({ state: "active", q: "SECOND" })).items.map((n) => n.id)).toEqual([second.id]);
    expect(await api.listTags()).toEqual([
      { name: "home", noteCount: 1 },
      { name: "work/meetings", noteCount: 1 },
    ]);
  });

  it("pages through the notes with a cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await api.createNote(`Note ${i}`, []);
      await new Promise((resolve) => setTimeout(resolve, 2)); // notes of the same millisecond are ordered by ID
    }

    const page1 = await api.listNotes({ state: "feed", limit: 2 });
    const page2 = await api.listNotes({ state: "feed", limit: 2, cursor: page1.nextCursor! });
    const page3 = await api.listNotes({ state: "feed", limit: 2, cursor: page2.nextCursor! });

    const seen = [...page1.items, ...page2.items, ...page3.items].map((n) => n.content);
    expect(seen).toEqual(["Note 4", "Note 3", "Note 2", "Note 1", "Note 0"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("edits, archives, trashes and deletes notes", async () => {
    const note = await api.createNote("Draft", []);
    const edited = await api.updateNote(note.id, "Final #done", []);
    expect(edited).toMatchObject({ content: "Final #done", tags: ["done"] });

    await api.patchNote(note.id, { isArchived: true });
    expect((await api.listNotes({ state: "archived" })).items).toHaveLength(1);
    expect(await api.listTags()).toEqual([]); // archived notes are not counted

    await api.patchNote(note.id, { isTrashed: true });
    expect((await api.listNotes({ state: "trash" })).items.map((n) => n.id)).toEqual([note.id]);
    expect(await api.emptyTrash()).toEqual({ notes: 1, files: 0 });
    expect(await rejection(api.patchNote(note.id, { isPinned: true }))).toMatchObject({ status: 404 });
  });

  it("refuses an edit to a note changed since it was opened", async () => {
    const note = await api.createNote("Original", []);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await api.updateNote(note.id, "Changed", []);

    const stale = await rejection(
      request("PUT", `/api/v1/notes/${note.id}`, { content: "Late", attachmentIds: [], expectedUpdatedAtUtc: note.updatedAtUtc }),
    );
    expect(stale.status).toBe(409);
  });

  it("keeps one daily note per day, and habits apart from notes", async () => {
    await api.createNote("# Today", [], { dailyDate: "2026-10-03" });
    expect((await api.dailyNote("2026-10-03"))?.content).toBe("# Today");
    expect(await api.dailyNote("2026-10-04")).toBeNull();
    expect((await rejection(api.createNote("Again", [], { dailyDate: "2026-10-03" }))).status).toBe(409);

    const habit = await api.createNote("Run", [], { kind: "Habit" });
    expect((await rejection(api.patchNote(habit.id, { kind: "Note" }))).status).toBe(400);
  });

  it("counts notes per day in a time zone, for the calendar", async () => {
    await api.importNote(
      { id: null, content: "Late evening", createdAt: new Date("2026-09-30T23:30:00Z"), updatedAt: new Date("2026-09-30T23:30:00Z"), pinned: false, archived: false, kind: "Note", dailyDate: null },
      [],
    );

    expect(await api.calendar("2026-09-01", "2026-10-31", "UTC", ["Note"])).toEqual([{ date: "2026-09-30", count: 1 }]);
    expect(await api.calendar("2026-09-01", "2026-10-31", "Asia/Tokyo", ["Note"])).toEqual([{ date: "2026-10-01", count: 1 }]);
  });

  it("keeps labels and the notes that carry them", async () => {
    const label = await api.labels.create("Ideas", "Blue");
    const note = await api.createNote("Labelled", []);
    await api.patchNote(note.id, { labelIds: [label.id] });

    expect((await api.labels.list()).map((l) => [l.name, l.noteCount])).toEqual([["Ideas", 1]]);
    expect((await api.listNotes({ state: "active", label: label.id })).items.map((n) => n.id)).toEqual([note.id]);
    expect((await rejection(api.patchNote(note.id, { labelIds: ["0192e5a0-0000-7000-8000-000000000000"] }))).status).toBe(400);

    await api.labels.remove(label.id);
    expect((await api.listNotes({ state: "active" })).items[0]!.labelIds).toEqual([]);
  });

  it("restores an export once, keeping each note's ID and dates", async () => {
    const restored = {
      id: "0192e5a0-1234-7000-8000-000000000001",
      content: "From the server",
      createdAt: new Date("2026-01-02T03:04:05Z"),
      updatedAt: new Date("2026-01-03T03:04:05Z"),
      pinned: true,
      archived: false,
      kind: "Todo" as const,
      dailyDate: null,
    };

    expect((await api.importNote(restored, [])).imported).toBe(true);
    expect((await api.importNote(restored, [])).imported).toBe(false);
    expect(await api.existingNotes([restored.id, "0192e5a0-1234-7000-8000-000000000002"])).toEqual([restored.id]);
    const [note] = (await api.listNotes({ state: "active", kinds: ["Todo"] })).items;
    expect(note).toMatchObject({ id: restored.id, createdAtUtc: "2026-01-02T03:04:05.000Z", isPinned: true, kind: "Todo" });
  });

  it("keeps preferences and the notebook's name", async () => {
    await api.setPreferences({ ...DEFAULT_PREFERENCES, theme: "Dark" });
    await api.updateDisplayName("Travel");

    expect((await api.status()).user).toMatchObject({ displayName: "Travel", preferences: { theme: "Dark" } });
  });

  it("holds no files and says so", async () => {
    const file = new File(["x"], "x.txt", { type: "text/plain" });

    expect((await rejection(uploadAttachment(file, () => undefined))).message).toBe("A notebook kept on this device cannot hold files.");
    expect((await rejection(api.admin.users())).status).toBe(404);
  });

  it("closes without the server, stays on the device, and opens again", async () => {
    await api.createNote("Still here", []);

    await api.logout();
    expect(await isNotebookOpen()).toBe(false);
    expect(await notebookOnDevice()).toMatchObject({ displayName: "Field notes", open: false });

    await openNotebook("Maple Notes");
    expect((await api.listNotes({ state: "feed" })).items.map((n) => n.content)).toEqual(["Still here"]);
    expect((await api.status()).branding?.appName).toBe("Maple Notes");
  });

  it("is deleted with every note in it", async () => {
    await api.createNote("Gone soon", []);
    await closeNotebook();

    await deleteNotebook();

    expect(await notebookOnDevice()).toBeNull();
    expect(await isNotebookOpen()).toBe(false);
  });
});
