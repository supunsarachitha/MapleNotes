import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { HomePage } from "../pages/HomePage";
import { api, ApiError } from "./api";
import { saveDailyNote } from "./daily";
import { DEFAULT_PREFERENCES } from "./preferences";
import { queryKeys } from "./queries";
import type { AuthStatus, Note, Preferences } from "./types";

const note = (overrides: Partial<Note>): Note => ({
  id: "d1",
  kind: "Note",
  dailyDate: "2026-09-29",
  content: "# Tuesday, 29 September 2026\n\nMorning run",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  updatedAtUtc: "2026-09-29T08:00:00Z",
  tags: [],
  attachments: [],
  ...overrides,
});

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 9, 30) }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("daily notes", () => {
  it("starts the day's note titled with the date", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(note({}));

    await saveDailyNote("2026-09-29", "Tuesday, 29 September 2026", "Morning run", ["a1"]);

    expect(create).toHaveBeenCalledWith("# Tuesday, 29 September 2026\n\nMorning run", ["a1"], { dailyDate: "2026-09-29" });
  });

  it("adds to the note when another device started the day first", async () => {
    vi.spyOn(api, "createNote").mockRejectedValue(new ApiError(409, { title: "This day already has a daily note." }));
    vi.spyOn(api, "dailyNote").mockResolvedValue(note({ attachments: [{ id: "old" } as Note["attachments"][number]] }));
    const update = vi.spyOn(api, "updateNote").mockResolvedValue(note({}));

    await saveDailyNote("2026-09-29", "Tuesday, 29 September 2026", "Lunch with Sam", ["new"]);

    expect(update).toHaveBeenCalledWith("d1", "# Tuesday, 29 September 2026\n\nMorning run\n\nLunch with Sam", ["old", "new"], expect.anything());
  });

  it("shows today's card on Home, keeps the daily note out of the feed, and starts it on first save", async () => {
    const yesterday = note({ id: "y1", dailyDate: "2026-09-28", content: "# Monday, 28 September 2026\n\nOld day" });
    vi.spyOn(api, "listNotes").mockImplementation(async ({ state }) => ({ items: state === "feed" ? [yesterday] : [], nextCursor: null }));
    const daily = vi.spyOn(api, "dailyNote").mockResolvedValue(null);
    const create = vi.spyOn(api, "createNote").mockResolvedValue(note({}));
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
        preferences: { ...DEFAULT_PREFERENCES, dailyNotes: true, dateFormat: "dddd, d MMMM yyyy" },
      },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <HomePage />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Tuesday, 29 September 2026")).toBeInTheDocument();
    expect(daily).toHaveBeenCalledWith("2026-09-29");
    expect(await screen.findByText("Old day")).toBeInTheDocument(); // earlier daily notes stay in the feed
    const [todayBox] = screen.getAllByLabelText("New note");
    await user.type(todayBox!, "Morning run");
    await user.click(screen.getAllByRole("button", { name: "Post" })[0]!);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("# Tuesday, 29 September 2026\n\nMorning run", [], { dailyDate: "2026-09-29" }),
    );
  });

  function renderHome(preferences: Partial<Preferences>) {
    vi.spyOn(api, "listNotes").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(api, "dailyNote").mockResolvedValue(null);
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
        preferences: { ...DEFAULT_PREFERENCES, dailyNotes: true, dateFormat: "dddd, d MMMM yyyy", ...preferences },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <HomePage />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("starts a new day's note with the template's text, without the template's title", async () => {
    const template = note({ id: "t1", dailyDate: null, kind: "Quick", content: "# Daily template\n\n## Plan\n- [ ] \n\n## Done\n" });
    const load = vi.spyOn(api, "note").mockResolvedValue(template);
    const create = vi.spyOn(api, "createNote").mockResolvedValue(note({}));
    renderHome({ dailyNoteTemplate: "t1" });

    await waitFor(() => expect(screen.getAllByLabelText("New note")[0]).toHaveValue("## Plan\n- [ ] \n\n## Done\n"));
    expect(load).toHaveBeenCalledWith("t1");
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Post" })[0]!);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("# Tuesday, 29 September 2026\n\n## Plan\n- [ ] \n\n## Done\n", [], { dailyDate: "2026-09-29" }),
    );
  });

  it("starts empty when the template note is in the trash or gone", async () => {
    vi.spyOn(api, "note").mockResolvedValue(note({ id: "t1", dailyDate: null, content: "Old template", trashedAtUtc: "2026-09-28T10:00:00Z" }));
    renderHome({ dailyNoteTemplate: "t1" });

    expect(await screen.findByText("Tuesday, 29 September 2026")).toBeInTheDocument();
    expect(screen.getAllByLabelText("New note")[0]).toHaveValue("");
  });

  it("does not load a template while none is chosen", async () => {
    const load = vi.spyOn(api, "note");
    renderHome({ dailyNoteTemplate: "" });

    expect(await screen.findByText("Tuesday, 29 September 2026")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});
