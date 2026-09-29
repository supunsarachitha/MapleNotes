import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { Composer } from "./Composer";
import { ToastProvider } from "./Toaster";

function renderComposer(props: Parameters<typeof Composer>[0] = {}, preferences: Partial<Preferences> = {}) {
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
      <ToastProvider>
        <Composer {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const savedNote: Note = {
  id: "n1",
  kind: "Note",
  content: "hello",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-28T12:00:00Z",
  updatedAtUtc: "2026-09-28T12:00:00Z",
  tags: [],
  attachments: [],
};

describe("Composer", () => {
  it("cannot post an empty note", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
  });

  it("posts with Ctrl+Enter and clears itself", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer();

    const box = screen.getByLabelText("New note");
    await user.type(box, "hello #world");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(create).toHaveBeenCalledWith("hello #world", []));
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("edits an existing note and reports completion", async () => {
    const update = vi.spyOn(api, "updateNote").mockResolvedValue({ ...savedNote, content: "hello again" });
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderComposer({ note: savedNote, onDone });

    const box = screen.getByLabelText("Edit note");
    await user.type(box, " again");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("n1", "hello again", []));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the server's validation message when saving fails", async () => {
    const { ApiError } = await import("../lib/api");
    vi.spyOn(api, "createNote").mockRejectedValue(new ApiError(400, { errors: { content: ["Too long."] } }));
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByLabelText("New note"), "x");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Too long.")).toBeInTheDocument();
  });

  it("has no title field unless note titles are on", () => {
    renderComposer();

    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });

  it("saves the title as the note's first line, as a heading", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer({}, { noteTitles: true });

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Weekend plans{Enter}");
    expect(screen.getByLabelText("New note")).toHaveFocus(); // Enter moves on to the text
    await user.keyboard("Hike the #trail");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("# Weekend plans\n\nHike the #trail", []));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(""));
  });

  it("starts the title with today's date, which alone is not enough to post", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 9, 30) });
    try {
      const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
      const user = userEvent.setup();
      renderComposer({}, { noteTitles: true, dateInTitles: true, dateFormat: "dddd, d MMMM yyyy" });

      const title = screen.getByRole("textbox", { name: "Title" });
      expect(title).toHaveValue("Tuesday, 29 September 2026");
      expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();

      await user.type(title, " – standup");
      await user.click(screen.getByRole("button", { name: "Post" }));

      await waitFor(() => expect(create).toHaveBeenCalledWith("# Tuesday, 29 September 2026 – standup", []));
      await waitFor(() => expect(title).toHaveValue("Tuesday, 29 September 2026"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits a note's title and text separately", async () => {
    const update = vi.spyOn(api, "updateNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer({ note: { ...savedNote, content: "# Groceries\n\n- [ ] oats" }, onDone: vi.fn() }, { noteTitles: true });

    const title = screen.getByRole("textbox", { name: "Edit title" });
    expect(title).toHaveValue("Groceries");
    expect(screen.getByLabelText("Edit note")).toHaveValue("- [ ] oats");
    await user.clear(title);
    await user.type(title, "Weekend groceries");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("n1", "# Weekend groceries\n\n- [ ] oats", []));
  });

  it("formats the selection from the toolbar and with shortcuts", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer();
    const box = screen.getByLabelText("New note") as HTMLTextAreaElement;

    await user.type(box, "Buy maple syrup");
    box.setSelectionRange(4, 9); // "maple"
    await user.click(within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(box).toHaveValue("Buy **maple** syrup"));

    box.setSelectionRange(0, 0);
    await user.click(screen.getByRole("button", { name: "Checklist" }));
    await waitFor(() => expect(box).toHaveValue("- [ ] Buy **maple** syrup"));

    box.setSelectionRange(box.value.length, box.value.length);
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(box).toHaveValue("- [ ] Buy **maple** syrup[link text](https://)"));

    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("- [ ] Buy **maple** syrup[link text](https://)", []));
  });
});
