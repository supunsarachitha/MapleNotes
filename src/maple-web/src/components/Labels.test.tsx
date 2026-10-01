import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Label, Note, Preferences } from "../lib/types";
import { HomePage } from "../pages/HomePage";
import { NoteCard } from "./NoteCard";
import { ToastProvider } from "./Toaster";

const work: Label = { id: "l-work", name: "Work", color: "Blue", noteCount: 2 };
const urgent: Label = { id: "l-urgent", name: "Urgent", color: "Red", noteCount: 1 };

const note: Note = {
  id: "n1",
  kind: "Note",
  content: "Quarterly report",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  updatedAtUtc: "2026-09-29T08:00:00Z",
  tags: [],
  attachments: [],
  labelIds: [work.id],
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
      preferences: { ...DEFAULT_PREFERENCES, labels: true, ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Labels on notes", () => {
  it("shows a note's labels as chips that list each label's notes", async () => {
    vi.spyOn(api.labels, "list").mockResolvedValue([urgent, work]);
    renderWith(<NoteCard note={{ ...note, labelIds: [work.id, urgent.id, "deleted-label"] }} />);

    const chips = await screen.findByRole("list", { name: "Labels" });
    expect(within(chips).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Urgent", "/?label=l-urgent"],
      ["Work", "/?label=l-work"],
    ]);
  });

  it("hides labels and their menu item while labels are turned off", async () => {
    const list = vi.spyOn(api.labels, "list").mockResolvedValue([work]);
    const user = userEvent.setup();
    renderWith(<NoteCard note={note} />, { labels: false });

    await user.click(screen.getByRole("button", { name: "Note actions" }));

    expect(screen.queryByRole("menuitem", { name: "Labels…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Labels" })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("chooses a note's labels, creating one on the way", async () => {
    let labels = [urgent, work];
    vi.spyOn(api.labels, "list").mockImplementation(async () => labels);
    const create = vi.spyOn(api.labels, "create").mockImplementation(async (name, color) => {
      const label: Label = { id: "l-new", name, color, noteCount: 0 };
      labels = [...labels, label];
      return label;
    });
    const patch = vi.spyOn(api, "patchNote").mockImplementation(async (_id, changes) => ({ ...note, ...changes }));
    const user = userEvent.setup();
    renderWith(<NoteCard note={note} />);

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Labels…" }));
    const dialog = await screen.findByRole("dialog", { name: "Labels" });
    expect(await within(dialog).findByRole("checkbox", { name: "Work" })).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "Find or create a label" })).not.toHaveFocus(); // no phone keyboard
    expect(dialog).toHaveFocus();
    await user.click(within(dialog).getByRole("checkbox", { name: "Work" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Urgent" }));

    await user.type(within(dialog).getByRole("textbox", { name: "Find or create a label" }), "Travel");
    expect(within(dialog).queryByRole("checkbox", { name: "Work" })).not.toBeInTheDocument(); // filtered
    await user.click(within(dialog).getByRole("button", { name: "Create label “Travel”" }));
    expect(await within(dialog).findByRole("checkbox", { name: "Travel" })).toBeChecked();
    expect(create).toHaveBeenCalledWith("Travel", expect.any(String));

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(note.id, { labelIds: ["l-urgent", "l-new"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers no second label of a name it already has", async () => {
    vi.spyOn(api.labels, "list").mockResolvedValue([work]);
    const user = userEvent.setup();
    renderWith(<NoteCard note={note} />);

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Labels…" }));
    await user.type(await screen.findByRole("textbox", { name: "Find or create a label" }), " work ");

    expect(screen.getByRole("checkbox", { name: "Work" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Create label/ })).not.toBeInTheDocument();
  });

  it("lists a label's notes on Home, under the label's name", async () => {
    vi.spyOn(api.labels, "list").mockResolvedValue([work]);
    const listNotes = vi.spyOn(api, "listNotes").mockResolvedValue({ items: [note], nextCursor: null });
    window.history.replaceState(null, "", "/?label=l-work");
    renderWith(<HomePage />);

    expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
    expect(await screen.findByText("Quarterly report")).toBeInTheDocument();
    expect(listNotes).toHaveBeenCalledWith(expect.objectContaining({ state: "active", label: "l-work" }));
  });
});
