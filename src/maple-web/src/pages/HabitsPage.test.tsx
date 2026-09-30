import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { HabitsPage } from "./HabitsPage";

const habit = (id: string, content: string, createdAtUtc: string, isArchived = false): Note => ({
  id,
  kind: "Habit",
  content,
  isPinned: false,
  isArchived,
  createdAtUtc,
  updatedAtUtc: createdAtUtc,
  tags: [],
  attachments: [],
});

const read = habit("h-read", "# Read 20 minutes\n\n- 2026-09-27\n- 2026-09-28", "2026-09-20T08:00:00Z");
const walk = habit("h-walk", "# Walk\n\n- 2026-09-29", "2026-09-01T08:00:00Z");
const stretch = habit("h-stretch", "# Stretch\n\n- 2026-08-01\n- 2026-08-02\n- 2026-08-03", "2026-08-01T08:00:00Z", true);

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

function serve(active: Note[], archived: Note[] = []) {
  return vi.spyOn(api, "listNotes").mockImplementation(async (params) => ({
    items: params.state === "archived" ? archived : active,
    nextCursor: null,
  }));
}

const saveReturns = () =>
  vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({
    ...(id === read.id ? read : walk),
    content,
    updatedAtUtc: new Date().toISOString(),
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); // today is Tuesday 29 September 2026, 10:00 on this device
  vi.setSystemTime(new Date(2026, 8, 29, 10, 0));
});

afterEach(() => vi.useRealTimers());

describe("Habits", () => {
  it("says when the habit tracker is turned off, as it is by default", () => {
    renderWith(<HabitsPage />);

    expect(screen.getByText("The habit tracker is turned off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn it on in Settings." })).toHaveAttribute("href", "/settings");
  });

  it("asks for a first habit", async () => {
    serve([]);
    renderWith(<HabitsPage />, { habitTracker: true });

    expect(await screen.findByText("No habits yet")).toBeInTheDocument();
  });

  it("lists habits oldest first with the last seven days, and ticks a day", async () => {
    const list = serve([read, walk]);
    const save = saveReturns();
    const user = userEvent.setup();
    renderWith(<HabitsPage />, { habitTracker: true });

    const habits = await screen.findByRole("list", { name: "Your habits" });
    expect(within(habits).getAllByRole("listitem").map((item) => item.firstChild?.textContent)).toEqual(["Walk", "Read 20 minutes"]);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["Habit"], state: "active" }));
    expect(screen.getByText(/Sep 23\s–\s29/)).toBeInTheDocument();
    const days = within(habits).getAllByRole("button", { name: /^Read 20 minutes, / });
    expect(days.map((day) => day.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false", "true", "true", "false"]);

    const today = screen.getByRole("button", { name: "Read 20 minutes, today, Tuesday, September 29" });
    await user.click(today);

    expect(today).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(save).toHaveBeenCalledWith(read.id, "# Read 20 minutes\n\n- 2026-09-27\n- 2026-09-28\n- 2026-09-29", []));
    await user.click(screen.getByRole("button", { name: "Read 20 minutes, Sunday, September 27" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(read.id, "# Read 20 minutes\n\n- 2026-09-28\n- 2026-09-29", []));
  });

  it("goes a week back and forward again, never past today", async () => {
    serve([read]);
    const user = userEvent.setup();
    renderWith(<HabitsPage />, { habitTracker: true });
    const later = await screen.findByRole("button", { name: "Later days" });

    expect(later).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Earlier days" }));

    expect(screen.getByText(/Sep 16\s–\s22/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read 20 minutes, Wednesday, September 16" })).toBeInTheDocument();
    expect(later).toBeEnabled();
    await user.click(later);
    expect(screen.getByRole("button", { name: "Read 20 minutes, today, Tuesday, September 29" })).toBeInTheDocument();
  });

  it("adds a habit", async () => {
    serve([]);
    const create = vi.spyOn(api, "createNote").mockResolvedValue(habit("h-new", "# Stretch", "2026-09-29T08:00:00Z"));
    const user = userEvent.setup();
    renderWith(<HabitsPage />, { habitTracker: true });

    await user.type(await screen.findByRole("textbox", { name: "New habit name" }), "  Stretch ");
    await user.click(screen.getByRole("button", { name: "Add habit" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("# Stretch", [], { kind: "Habit" }));
    expect(screen.getByRole("textbox", { name: "New habit name" })).toHaveValue("");
  });

  it("renames, archives and deletes a habit from its menu", async () => {
    serve([read]);
    const save = saveReturns();
    const patch = vi.spyOn(api, "patchNote").mockResolvedValue({ ...read, isArchived: true });
    const remove = vi.spyOn(api, "deleteNote").mockResolvedValue();
    const user = userEvent.setup();
    renderWith(<HabitsPage />, { habitTracker: true });

    await user.click(await screen.findByRole("button", { name: "Habit actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const name = await screen.findByRole("textbox", { name: "Habit name" });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Read 30 minutes{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledWith(read.id, "# Read 30 minutes\n\n- 2026-09-27\n- 2026-09-28", []));

    await user.click(screen.getByRole("button", { name: "Habit actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(read.id, { isArchived: true }));

    await user.click(screen.getByRole("button", { name: "Habit actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this habit?" });
    expect(dialog).toHaveTextContent('"Read 30 minutes" and its history (2 days done) will be deleted permanently.');
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove.mock.calls[0]?.[0]).toBe(read.id));
  });

  it("keeps archived habits aside, to restore or delete", async () => {
    serve([read], [stretch]);
    const patch = vi.spyOn(api, "patchNote").mockResolvedValue({ ...stretch, isArchived: false });
    const user = userEvent.setup();
    renderWith(<HabitsPage />, { habitTracker: true });

    const toggle = await screen.findByRole("button", { name: "Archived habits (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Stretch")).not.toBeInTheDocument();
    await user.click(toggle);

    expect(screen.getByText("Stretch")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stretch, / })).not.toBeInTheDocument(); // no days to tick
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(stretch.id, { isArchived: false }));
  });
});
