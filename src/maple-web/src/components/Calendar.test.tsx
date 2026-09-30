import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { dayRange, parseDateKey } from "../lib/dates";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Preferences } from "../lib/types";
import { HomePage } from "../pages/HomePage";
import { Calendar } from "./Calendar";
import { ToastProvider } from "./Toaster";

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
      preferences: { ...DEFAULT_PREFERENCES, dateFormat: "dddd, d MMMM yyyy", ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 9, 30) }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Calendar", () => {
  it("marks the days with notes and links each day to its notes", async () => {
    const calendar = vi.spyOn(api, "calendar").mockResolvedValue([{ date: "2026-09-03", count: 1 }, { date: "2026-09-29", count: 3 }]);
    renderWith(<Calendar />);

    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    const today = await screen.findByRole("link", { name: "Tuesday, September 29, 2026, 3 notes (today)" });
    expect(today).toHaveAttribute("href", "/?day=2026-09-29");
    expect(screen.getByRole("link", { name: "Thursday, September 3, 2026, 1 note" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Friday, September 4, 2026" })).toBeInTheDocument();
    expect(calendar).toHaveBeenCalledWith("2026-09-01", "2026-09-30", expect.any(String), ["Note", "Todo", "Quick"]);
  });

  it("starts the week on the day the user chose", () => {
    vi.spyOn(api, "calendar").mockResolvedValue([]);
    const { container, unmount } = renderWith(<Calendar />, { weekStart: "Monday" });
    const header = () => container.querySelector('[aria-hidden="true"].grid-cols-7')!.textContent;

    expect(header()).toBe("MoTuWeThFrSaSu");
    expect(container.querySelectorAll('ol li[aria-hidden="true"]')).toHaveLength(1); // September 1, 2026 is a Tuesday
    unmount();

    const saturday = renderWith(<Calendar />, { weekStart: "Saturday" });
    expect(saturday.container.querySelector('[aria-hidden="true"].grid-cols-7')!.textContent).toBe("SaSuMoTuWeThFr");
    expect(saturday.container.querySelectorAll('ol li[aria-hidden="true"]')).toHaveLength(3);
  });

  it("moves between months", async () => {
    const calendar = vi.spyOn(api, "calendar").mockResolvedValue([]);
    const user = userEvent.setup();
    renderWith(<Calendar />);

    await user.click(screen.getByRole("button", { name: "Previous month" }));

    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();
    await waitFor(() => expect(calendar).toHaveBeenLastCalledWith("2026-08-01", "2026-08-31", expect.any(String), ["Note", "Todo", "Quick"]));
    expect(screen.getAllByRole("link")).toHaveLength(31);
  });

  it("shows the notes of the chosen day on Home", async () => {
    window.history.replaceState(null, "", "/?day=2026-09-03");
    const list = vi.spyOn(api, "listNotes").mockResolvedValue({ items: [], nextCursor: null });
    renderWith(<HomePage />);

    expect(screen.getByRole("heading", { name: "Thursday, 3 September 2026" })).toBeInTheDocument();
    expect(await screen.findByText("No notes on this day")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ state: "active", ...dayRange("2026-09-03") }));
  });

  it("turns a day into the instants it starts and ends on this device", () => {
    const { createdFrom, createdBefore } = dayRange("2026-03-08");

    expect(new Date(createdFrom!).getTime()).toBe(new Date(2026, 2, 8).getTime());
    expect(new Date(createdBefore!).getTime()).toBe(new Date(2026, 2, 9).getTime());
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(dayRange("not a day")).toEqual({});
  });
});
