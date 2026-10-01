import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCard } from "../components/NoteCard";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { QuickNotesPage } from "./QuickNotesPage";

const quick: Note = {
  id: "q1",
  kind: "Quick",
  content: "Call the plumber",
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

afterEach(() => vi.restoreAllMocks());

describe("Quick notes", () => {
  it("posts quick notes without a title field, and lists only quick notes", async () => {
    const list = vi.spyOn(api, "listNotes").mockResolvedValue({ items: [quick], nextCursor: null });
    const create = vi.spyOn(api, "createNote").mockResolvedValue(quick);
    const user = userEvent.setup();
    renderWith(<QuickNotesPage />, { noteTitles: true });

    expect(await screen.findByText("Call the plumber")).toBeInTheDocument();
    expect(screen.queryByText("Quick note")).not.toBeInTheDocument(); // no label inside its own tab
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["Quick"] }));

    await user.type(screen.getByPlaceholderText("Jot something down…"), "Buy stamps");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("Buy stamps", [], { kind: "Quick" }));
  });

  it("gives quick notes a title when titles are on for them", async () => {
    vi.spyOn(api, "listNotes").mockResolvedValue({ items: [], nextCursor: null });
    const create = vi.spyOn(api, "createNote").mockResolvedValue(quick);
    const user = userEvent.setup();
    renderWith(<QuickNotesPage />, { noteTitles: true, quickNoteTitles: true });

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Errands");
    await user.type(screen.getByPlaceholderText("Jot something down…"), "Buy stamps");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("# Errands\n\nBuy stamps", [], { kind: "Quick" }));
  });

  it("edits a quick note's title only when titles are on for quick notes", async () => {
    const titled = { ...quick, content: "# Errands\n\nBuy stamps" };
    const user = userEvent.setup();
    const view = renderWith(<NoteCard note={titled} />, { noteTitles: true, quickNoteTitles: true });

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit title" })).toHaveValue("Errands");
    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue("Buy stamps");
    view.unmount();

    renderWith(<NoteCard note={titled} />, { noteTitles: true });
    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(screen.queryByRole("textbox", { name: "Edit title" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue("# Errands\n\nBuy stamps");
  });

  it("ticks checkboxes in a quick note, showing the tick at once and saving the note", async () => {
    const checklist = { ...quick, content: "# Errands\n\n- [ ] stamps\n- [x] milk" };
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...checklist, id, content }));
    const user = userEvent.setup();
    renderWith(<NoteCard note={checklist} showKind={false} />, { noteTitles: true }); // the title is shown apart

    await user.click(screen.getByRole("checkbox", { name: "stamps" }));
    expect(screen.getByRole("checkbox", { name: "stamps" })).toBeChecked();
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("q1", "# Errands\n\n- [x] stamps\n- [x] milk", []));

    await user.click(screen.getByRole("checkbox", { name: "milk" }));
    expect(screen.getByRole("checkbox", { name: "milk" })).not.toBeChecked();
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("q1", "# Errands\n\n- [x] stamps\n- [ ] milk", []));
  });

  it("keeps the checkboxes of archived notes as they are", () => {
    renderWith(<NoteCard note={{ ...quick, content: "- [ ] stamps", isArchived: true }} />);

    expect(screen.getByRole("checkbox", { name: "stamps" })).toBeDisabled();
  });

  it("moves a quick note to Home and a note to quick notes", async () => {
    const patch = vi.spyOn(api, "patchNote").mockResolvedValue({ ...quick, kind: "Note" });
    const user = userEvent.setup();
    renderWith(
      <>
        <NoteCard note={quick} />
        <NoteCard note={{ ...quick, id: "n1", kind: "Note", content: "A timeline note" }} />
      </>,
    );

    const [quickMenu, noteMenu] = screen.getAllByRole("button", { name: "Note actions" });
    await user.click(quickMenu!);
    await user.click(await screen.findByRole("menuitem", { name: "Move to Home" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("q1", { kind: "Note" }));

    await user.click(noteMenu!);
    await user.click(await screen.findByRole("menuitem", { name: "Move to quick notes" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("n1", { kind: "Quick" }));
  });

  it("offers no move to quick notes while they are turned off", async () => {
    const user = userEvent.setup();
    renderWith(<NoteCard note={{ ...quick, kind: "Note" }} />, { quickNotes: false });

    await user.click(screen.getByRole("button", { name: "Note actions" }));

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to quick notes" })).not.toBeInTheDocument();
  });

  it("says when quick notes are turned off", () => {
    renderWith(<QuickNotesPage />, { quickNotes: false });

    expect(screen.getByText("Quick notes are turned off")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Jot something down…")).not.toBeInTheDocument();
  });
});
