import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { NoteCard } from "./NoteCard";
import { ToastProvider } from "./Toaster";

const note: Note = {
  id: "n1",
  kind: "Note",
  content: "Call the plumber about the [sink](https://example.com)\n\n- [ ] book a time",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  updatedAtUtc: "2026-09-29T08:00:00Z",
  tags: [],
  attachments: [],
};

function renderWith(children: ReactNode, preferences: Partial<Preferences> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u",
      username: "maple",
      displayName: "Maple",
      role: "User",
      encryptionMode: "AtRest",
      hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z",
      preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}

// One tap at a point at a time in milliseconds; `move` is how far the finger slides before lifting.
function tap(element: Element, at: number, { x = 50, y = 50, move = 0 } = {}) {
  vi.spyOn(performance, "now").mockReturnValue(at);
  fireEvent.touchStart(element, { touches: [{ clientX: x, clientY: y }] });
  fireEvent.touchEnd(element, { touches: [], changedTouches: [{ clientX: x + move, clientY: y }] });
}

const editor = () => screen.queryByRole("textbox", { name: "Edit note" });

afterEach(() => vi.restoreAllMocks());

describe("Double-tap to edit", () => {
  it("opens a note for editing when it is double-clicked", async () => {
    renderWith(<NoteCard note={note} />, { doubleTapToEdit: true });

    await userEvent.dblClick(screen.getByText(/Call the plumber/));

    expect(editor()).toHaveValue(note.content);
    expect(editor()).toHaveFocus();
  });

  it("does nothing when it is turned off, or for archived notes", async () => {
    renderWith(<NoteCard note={note} />);
    await userEvent.dblClick(screen.getByText(/Call the plumber/));
    expect(editor()).not.toBeInTheDocument();

    renderWith(<NoteCard note={{ ...note, id: "n2", isArchived: true, content: "Old news" }} />, { doubleTapToEdit: true });
    await userEvent.dblClick(screen.getByText("Old news"));
    expect(editor()).not.toBeInTheDocument();
  });

  it("leaves links, checkboxes and the menu alone", async () => {
    renderWith(<NoteCard note={note} />, { doubleTapToEdit: true });

    fireEvent.doubleClick(screen.getByRole("link", { name: "sink" }));
    fireEvent.doubleClick(screen.getByRole("checkbox", { name: "book a time" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Note actions" }));

    expect(editor()).not.toBeInTheDocument();
  });

  it("opens a note on a double-tap, cancelling the tap so nothing behind it is clicked", () => {
    renderWith(<NoteCard note={note} />, { doubleTapToEdit: true });
    const text = screen.getByText(/Call the plumber/);

    tap(text, 1000);
    expect(editor()).not.toBeInTheDocument();
    vi.spyOn(performance, "now").mockReturnValue(1200);
    fireEvent.touchStart(text, { touches: [{ clientX: 52, clientY: 49 }] });
    const lifted = fireEvent.touchEnd(text, { touches: [], changedTouches: [{ clientX: 52, clientY: 49 }] });

    expect(lifted).toBe(false); // default prevented: no click follows
    expect(editor()).toBeInTheDocument();
  });

  it("ignores slow taps, taps far apart, scrolls and taps on links", () => {
    renderWith(<NoteCard note={note} />, { doubleTapToEdit: true });
    const text = screen.getByText(/Call the plumber/);
    const link = screen.getByRole("link", { name: "sink" });

    tap(text, 1000);
    tap(text, 1500); // too slow
    tap(text, 3000, { x: 50 });
    tap(text, 3100, { x: 150 }); // too far from the first
    tap(text, 5000);
    tap(text, 5100, { move: 80 }); // a scroll, not a tap
    tap(link, 7000);
    tap(link, 7100);

    expect(editor()).not.toBeInTheDocument();
  });
});

describe("Deleting a note", () => {
  it("moves it to the trash at once, and Undo brings it back", async () => {
    const patch = vi.spyOn(api, "patchNote").mockImplementation(async (_id, changes) => ({ ...note, ...changes }));
    const remove = vi.spyOn(api, "deleteNote");
    const user = userEvent.setup();
    renderWith(<NoteCard note={note} />);

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to trash" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(note.id, { isTrashed: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // nothing to confirm: it can be restored
    expect(await screen.findByText("Note moved to the trash.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith(note.id, { isTrashed: false }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("asks first and deletes it for good when the trash is off", async () => {
    const remove = vi.spyOn(api, "deleteNote").mockResolvedValue();
    const patch = vi.spyOn(api, "patchNote");
    const user = userEvent.setup();
    renderWith(<NoteCard note={note} />, { trash: false });

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this note?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(remove.mock.calls[0]?.[0]).toBe(note.id));
    expect(await screen.findByText("Note deleted.")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});
