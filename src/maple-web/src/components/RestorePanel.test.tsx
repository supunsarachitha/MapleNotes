import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { Note } from "../lib/types";
import { RestorePanel } from "./RestorePanel";

afterEach(() => vi.restoreAllMocks());

describe("RestorePanel", () => {
  it("reads the chosen files, restores them and reports what happened", async () => {
    vi.spyOn(api, "existingNotes").mockResolvedValue(["0192f3a2-0000-7000-8000-000000000001"]);
    const restore = vi.spyOn(api, "importNote").mockResolvedValue({ imported: true, note: {} as Note });
    const user = userEvent.setup({ applyAccept: false }); // pickers can be switched to "All files"
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RestorePanel endToEnd={false} />
      </QueryClientProvider>,
    );
    const known = "---\nid: 0192f3a2-0000-7000-8000-000000000001\nkind: note\ncreated: 2025-01-01T10:00:00+01:00\nupdated: 2025-01-01T10:00:00+01:00\ntags: []\npinned: false\narchived: false\n---\n\nAlready here\n";

    await user.upload(screen.getByLabelText("Files to restore"), [
      new File([known], "known.md"),
      new File(["# Ideas\n\nNew"], "ideas.md"),
      new File(["x"], "clip.mp4"),
    ]);

    expect(await screen.findByRole("button", { name: "Restore 2 notes" })).toBeInTheDocument();
    expect(screen.getByText("clip.mp4: choose .zip, .md, .txt or .json files.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore 2 notes" }));

    expect(await screen.findByText("Restored 1 note and 0 files. 1 note was already here.")).toBeInTheDocument();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]![0]).toMatchObject({ id: null, content: "# Ideas\n\nNew", kind: "Note" });
  });

  it("stops when the storage is full, and says how to finish", async () => {
    vi.spyOn(api, "existingNotes").mockResolvedValue([]);
    vi.spyOn(api, "importNote")
      .mockResolvedValueOnce({ imported: true, note: {} as Note })
      .mockRejectedValue(
        new ApiError(507, { title: "There is not enough room in your storage.", detail: "Delete notes or files to make room, or ask an administrator for more space." }),
      );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RestorePanel endToEnd={false} />
      </QueryClientProvider>,
    );

    await user.upload(screen.getByLabelText("Files to restore"), [
      new File(["First"], "first.md"),
      new File(["Second"], "second.md"),
      new File(["Third"], "third.md"),
    ]);
    await user.click(await screen.findByRole("button", { name: "Restore 3 notes" }));

    expect(await screen.findByText("Restored 1 note and 0 files.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Stopped before the last 2 notes. There is not enough room in your storage. Delete notes or files to make room, or ask an administrator for more space. Then restore the same file again: notes already restored are skipped.",
    );
  });
});
