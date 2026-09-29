import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { linksIn } from "../lib/links";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { NoteCard } from "./NoteCard";
import { FeaturesSection } from "./PreferenceSections";
import { ToastProvider } from "./Toaster";

const note: Note = {
  id: "n1",
  kind: "Note",
  content: "Read [this story](https://news.example/story). Also https://blog.example/post, again https://news.example/story",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  updatedAtUtc: "2026-09-29T08:00:00Z",
  tags: [],
  attachments: [],
};

function renderWith(ui: React.ReactNode, preferences: Partial<Preferences>, status: Partial<AuthStatus> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    linkPreviewsAvailable: true,
    user: { id: "u", username: "m", displayName: "M", role: "User", encryptionMode: "AtRest", hasEndToEndKey: false, createdAtUtc: "", preferences: { ...DEFAULT_PREFERENCES, ...preferences } },
    ...status,
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("link previews", () => {
  it("finds the first distinct web links, leaving out code", () => {
    expect(linksIn(note.content)).toEqual(["https://news.example/story", "https://blog.example/post"]);
    expect(linksIn("`https://in.code/x` and\n```\nhttps://in.block/y\n```\nhttps://real.example/z.", 5)).toEqual(["https://real.example/z"]);
    expect(linksIn("no links, just ftp://old.example")).toEqual([]);
  });

  it("shows previews only when the account turned them on", async () => {
    const preview = vi.spyOn(api, "linkPreview").mockImplementation(async (url) =>
      url.includes("news") ? { url, title: "A story", description: "What happened", siteName: "News" } : null,
    );
    renderWith(<NoteCard note={note} />, { linkPreviews: true });

    expect(await screen.findByRole("link", { name: /A story/ })).toHaveAttribute("href", "https://news.example/story");
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2); // the page without a preview shows nothing
  });

  it("fetches nothing while they are off, or when the server does not allow them", () => {
    const preview = vi.spyOn(api, "linkPreview");
    renderWith(<NoteCard note={note} />, { linkPreviews: false });
    renderWith(<NoteCard note={{ ...note, id: "n2" }} />, { linkPreviews: true }, { linkPreviewsAvailable: false });

    expect(preview).not.toHaveBeenCalled();
  });

  it("explains what the server learns, especially for end-to-end accounts", () => {
    renderWith(<FeaturesSection />, {}, { user: { id: "u", username: "m", displayName: "M", role: "User", encryptionMode: "EndToEnd", hasEndToEndKey: true, createdAtUtc: "", preferences: DEFAULT_PREFERENCES } });

    expect(screen.getByRole("switch", { name: "Link previews" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/even though your notes are end-to-end encrypted/)).toBeInTheDocument();
    expect(screen.getByText(/Privacy cost/)).toBeInTheDocument();
  });

  it("asks before turning previews on, and turns them off at once", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    const user = userEvent.setup();
    renderWith(<FeaturesSection />, {});

    await user.click(screen.getByRole("switch", { name: "Link previews" }));
    const dialog = screen.getByRole("dialog", { name: "Turn on link previews?" });
    expect(dialog).toHaveTextContent("The server learns the addresses you save.");
    expect(save).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("switch", { name: "Link previews" })).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("switch", { name: "Link previews" }));
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, linkPreviews: true }));

    await user.click(screen.getByRole("switch", { name: "Link previews" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, linkPreviews: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the switch when the server does not allow previews", () => {
    renderWith(<FeaturesSection />, {}, { linkPreviewsAvailable: false });

    expect(screen.queryByRole("switch", { name: "Link previews" })).not.toBeInTheDocument();
  });
});
