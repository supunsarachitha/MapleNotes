import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { daysLeft, TrashPage } from "./TrashPage";

const day = 86_400_000;
const deleted = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();

const report: Note = {
  id: "n-report",
  kind: "Note",
  content: "# Quarterly report\n\nNumbers for the board",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-01T08:00:00Z",
  updatedAtUtc: "2026-09-01T08:00:00Z",
  tags: [],
  attachments: [{ id: "a1", fileName: "chart.png", contentType: "image/png", sizeBytes: 10, isImage: true, url: "/a/1", createdAtUtc: "2026-09-01T08:00:00Z" }],
  trashedAtUtc: deleted(2),
};
const stretch: Note = { ...report, id: "n-stretch", kind: "Habit", content: "# Stretch\n\n- 2026-09-01\n- 2026-09-02", attachments: [], trashedAtUtc: deleted(29.5) };

function renderTrash(notes: Note[], preferences: Partial<Preferences> = {}) {
  const list = vi.spyOn(api, "listNotes").mockResolvedValue({ items: notes, nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u", username: "maple", displayName: "Maple", role: "User", encryptionMode: "AtRest", hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z", preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TrashPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return list;
}

afterEach(() => vi.restoreAllMocks());

describe("Trash", () => {
  it("lists every kind of deleted note with when it goes for good, without loading their files", async () => {
    const list = renderTrash([report, stretch]);

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Note")).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/Deleted 2 days ago/)).toBeInTheDocument();
    expect(within(cards[0]!).getByText("· deleted for good in 28 days")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("With 1 file")).toBeInTheDocument();
    expect(within(cards[0]!).queryByRole("img")).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText("Habit")).toBeInTheDocument();
    expect(within(cards[1]!).getByText(/Stretch/)).toHaveTextContent("Stretch · 2 days done");
    expect(within(cards[1]!).getByText("· deleted for good in 1 day")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ state: "trash", kinds: ["Note", "Todo", "Quick", "Habit"] }));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/data");
  });

  it("restores a note, or deletes it for good after asking", async () => {
    const patch = vi.spyOn(api, "patchNote").mockResolvedValue({ ...report, trashedAtUtc: null });
    const remove = vi.spyOn(api, "deleteNote").mockResolvedValue();
    const user = userEvent.setup();
    renderTrash([report, stretch]);
    const [first, second] = await screen.findAllByRole("article");

    await user.click(within(first!).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(report.id, { isTrashed: false }));
    expect(await screen.findByText("Restored.")).toBeInTheDocument();

    await user.click(within(second!).getByRole("button", { name: "Delete forever…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete forever?" })).getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(remove.mock.calls[0]?.[0]).toBe(stretch.id));
  });

  it("empties the trash after asking", async () => {
    const empty = vi.spyOn(api, "emptyTrash").mockResolvedValue({ notes: 2, files: 1 });
    const user = userEvent.setup();
    renderTrash([report, stretch]);

    await user.click(await screen.findByRole("button", { name: "Empty trash…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Empty the trash?" })).getByRole("button", { name: "Empty trash" }));

    await waitFor(() => expect(empty).toHaveBeenCalled());
    expect(await screen.findByText("Deleted 2 notes and 1 file for good.")).toBeInTheDocument();
  });

  it("says when it is empty, and when the trash is turned off", async () => {
    renderTrash([], { trash: false });

    expect(await screen.findByText("The trash is empty")).toBeInTheDocument();
    expect(screen.getByText(/The trash is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty trash…" })).not.toBeInTheDocument();
  });

  it("counts the days left from when a note was deleted", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(daysLeft("2026-10-01T12:00:00Z", now)).toBe(30);
    expect(daysLeft("2026-09-01T13:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-08-01T00:00:00Z", now)).toBe(0);
  });
});
