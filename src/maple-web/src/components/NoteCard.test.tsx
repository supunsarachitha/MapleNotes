import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
