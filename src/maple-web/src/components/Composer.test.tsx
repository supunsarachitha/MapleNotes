import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { Note } from "../lib/types";
import { Composer } from "./Composer";
import { ToastProvider } from "./Toaster";

function renderComposer(props: Parameters<typeof Composer>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});
