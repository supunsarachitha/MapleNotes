import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { DEFAULT_PREFERENCES, usePreferences, useUpdatePreferences } from "./preferences";
import { queryKeys } from "./queries";
import type { AuthStatus, Preferences, User } from "./types";

const user: User = {
  id: "u",
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

function setUp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData<AuthStatus>(queryKeys.status, { setupRequired: false, registrationOpen: false, user });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ preferences: usePreferences(), update: useUpdatePreferences() }), { wrapper });
  return { client, hook };
}

afterEach(() => vi.restoreAllMocks());

describe("preferences", () => {
  it("shows a change at once and sends every preference with it", async () => {
    let answer!: (saved: Preferences) => void;
    const save = vi.spyOn(api, "setPreferences").mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { hook } = setUp();

    act(() => hook.result.current.update.mutate({ noteTitles: true, dateFormat: "d MMM yyyy" }));

    await waitFor(() => expect(hook.result.current.preferences.noteTitles).toBe(true));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFERENCES, noteTitles: true, dateFormat: "d MMM yyyy" }));
    act(() => answer({ ...DEFAULT_PREFERENCES, noteTitles: true, dateFormat: "d MMM yyyy" }));
    await waitFor(() => expect(hook.result.current.update.isSuccess).toBe(true));
    expect(hook.result.current.preferences.dateFormat).toBe("d MMM yyyy");
  });

  it("sends changes one after another, each with everything changed so far", async () => {
    const answers: Array<() => void> = [];
    const save = vi.spyOn(api, "setPreferences").mockImplementation(
      (preferences) => new Promise((resolve) => answers.push(() => resolve(preferences))),
    );
    const { hook } = setUp();

    act(() => hook.result.current.update.mutate({ todoLists: false }));
    act(() => hook.result.current.update.mutate({ quickNotes: false }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => answers[0]!());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    act(() => answers[1]!());

    await waitFor(() => expect(hook.result.current.preferences).toEqual({ ...DEFAULT_PREFERENCES, todoLists: false, quickNotes: false }));
    expect(save.mock.calls[1]![0]).toEqual({ ...DEFAULT_PREFERENCES, todoLists: false, quickNotes: false });
  });

  it("rolls a change back when it cannot be saved", async () => {
    vi.spyOn(api, "setPreferences").mockRejectedValue(new ApiError(500, { title: "Server error" }));
    const { hook } = setUp();

    act(() => hook.result.current.update.mutate({ dailyNotes: true }));

    await waitFor(() => expect(hook.result.current.update.isError).toBe(true));
    expect(hook.result.current.preferences.dailyNotes).toBe(false);
  });
});
