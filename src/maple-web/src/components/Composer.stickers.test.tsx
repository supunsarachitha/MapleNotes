import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { StickerPack } from "../lib/stickers";
import type { Attachment, AuthStatus, Note, Preferences } from "../lib/types";

// The composer's mood and sticker buttons (Falcon Notes docs/07, Moods and Stickers). The packs and the upload are
// stand-ins: the packs themselves are tested in lib/stickers.test.ts.

const pack: StickerPack = {
  id: "friends",
  name: "Friends",
  author: null,
  licence: null,
  version: null,
  added: 1,
  stickers: [
    { packId: "friends", file: "001.png", name: "Waving cat", contentType: "image/png" },
    { packId: "friends", file: "002.gif", name: "Sleepy", contentType: "image/gif" },
  ],
};
const other: StickerPack = { ...pack, id: "other", name: "Other", stickers: [{ ...pack.stickers[0]!, packId: "other", name: "Owl" }] };

const packs = vi.hoisted(() => ({ list: [] as StickerPack[] }));
vi.mock("../lib/stickers", async (original) => ({
  ...(await original<typeof import("../lib/stickers")>()),
  useStickerPacks: () => packs.list,
  useStickerSrc: () => "blob:sticker",
  stickerFile: async (sticker: { name: string; file: string }) =>
    new File([new Uint8Array([1, 2, 3])], `${sticker.name}${sticker.file.slice(sticker.file.lastIndexOf("."))}`, { type: "image/png" }),
}));

const uploads = vi.hoisted(() => ({ calls: [] as Array<{ file: File; options: unknown }> }));
vi.mock("../lib/api", async (original) => {
  const actual = await original<typeof import("../lib/api")>();
  return {
    ...actual,
    uploadAttachment: async (file: File, _progress: unknown, _signal: unknown, options: unknown) => {
      uploads.calls.push({ file, options });
      return {
        id: `a${uploads.calls.length}`,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        isImage: true,
        isSticker: true,
        url: `/api/v1/attachments/a${uploads.calls.length}`,
        createdAtUtc: "2026-10-26T12:00:00Z",
      } satisfies Attachment;
    },
  };
});

const { api } = await import("../lib/api");
const { Composer } = await import("./Composer");
const { ToastProvider } = await import("./Toaster");

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

describe("Composer moods", () => {
  it("offers no smilies or stickers while the features are off, as installed", () => {
    renderComposer();
    expect(screen.queryByRole("button", { name: "Mood" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stickers" })).not.toBeInTheDocument();
  });

  it("posts a quick note with the mood chosen, and starts the next one without", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer({ kind: "Quick" }, { moodTracker: true });

    await user.click(screen.getByRole("button", { name: "Mood" }));
    const smilies = screen.getByRole("group", { name: "Mood" });
    expect(within(smilies).getAllByRole("button").map((b) => b.textContent)).toEqual(["😢", "🙁", "😐", "🙂", "😄"]);
    await user.click(within(smilies).getByRole("button", { name: "Good" }));
    expect(screen.getByRole("button", { name: "Mood: Good" })).toHaveTextContent("🙂");

    await user.type(screen.getByLabelText("New note"), "sunny");
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("sunny", [], { kind: "Quick", mood: "Good" }));
    expect(await screen.findByRole("button", { name: "Mood" })).toBeInTheDocument();
  });

  it("has no smilies or stickers for a todo list being edited", () => {
    renderComposer({ note: { ...savedNote, kind: "Todo" }, onDone: () => undefined }, { moodTracker: true, stickers: true });
    expect(screen.queryByRole("button", { name: /^Mood/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stickers" })).not.toBeInTheDocument();
  });

  it("keeps the note's mood when an edit is saved with the mood tracker off", async () => {
    const update = vi.spyOn(api, "updateNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer({ note: { ...savedNote, mood: "Awful" }, onDone: () => undefined });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("n1", "hello", [], expect.anything()));
  });
});

describe("Composer stickers", () => {
  it("says where to add a pack when there is none", async () => {
    packs.list = [];
    const user = userEvent.setup();
    renderComposer({}, { stickers: true });
    await user.click(screen.getByRole("button", { name: "Stickers" }));
    expect(screen.getByRole("group", { name: "Stickers" })).toHaveTextContent("No sticker packs yet. Add one in Settings → Features.");
    expect(screen.getByRole("link", { name: "Settings → Features" })).toHaveAttribute("href", "/settings/features");
  });

  it("adds each sticker chosen as a sticker file, keeps the picker open, and posts with them", async () => {
    packs.list = [pack, other];
    uploads.calls = [];
    const create = vi.spyOn(api, "createNote").mockResolvedValue(savedNote);
    const user = userEvent.setup();
    renderComposer({}, { stickers: true, moodTracker: true });

    const button = screen.getByRole("button", { name: "Stickers" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const picker = screen.getByRole("group", { name: "Stickers" });
    expect(within(picker).getByRole("button", { name: "Friends" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(picker).getByRole("button", { name: "Add sticker: Waving cat" }));
    await user.click(within(picker).getByRole("button", { name: "Other" }));
    await user.click(within(picker).getByRole("button", { name: "Add sticker: Owl" }));
    expect(screen.getByRole("group", { name: "Stickers" })).toBeInTheDocument();

    const files = screen.getByRole("list", { name: "Attached files" });
    await waitFor(() => expect(within(files).getAllByRole("listitem")).toHaveLength(2));
    await waitFor(() => expect(uploads.calls).toHaveLength(2));
    expect(uploads.calls.map((call) => [call.file.name, call.options])).toEqual([
      ["Waving cat.png", { sticker: true }],
      ["Owl.png", { sticker: true }],
    ]);

    // The smilies and the stickers take the same place: opening one closes the other.
    await user.click(screen.getByRole("button", { name: "Mood" }));
    expect(screen.queryByRole("group", { name: "Stickers" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stickers" }));

    // A sticker alone is enough to post.
    await waitFor(() => expect(screen.getByRole("button", { name: "Post" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("", ["a1", "a2"]));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Stickers" })).not.toBeInTheDocument());
  });
});
