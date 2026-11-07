import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note } from "../lib/types";
import { RemindersPage } from "./RemindersPage";

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

const note = (id: string, content: string): Note => ({
  id, kind: "Note", content, isPinned: false, isArchived: false, createdAtUtc: "2026-11-01T09:00:00Z", updatedAtUtc: "2026-11-01T09:00:00Z",
  tags: [], attachments: [], labelIds: [],
});

function renderPage(path = "/reminders") {
  history.replaceState(null, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false, registrationOpen: false,
    user: { id: "u", username: "maple", displayName: "Maple", role: "User", encryptionMode: "AtRest", hasEndToEndKey: false, createdAtUtc: "2026-09-28T12:00:00Z", preferences: DEFAULT_PREFERENCES },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RemindersPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Reminders page", () => {
  it("lists upcoming reminders by day with their notes, and the note a notification opened", async () => {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    vi.spyOn(api.reminders, "list").mockResolvedValue([
      { noteId: "a", at: "2026-11-07T09:00", timeZone: "UTC", repeat: "None", nextAtUtc: soon, lastSentAtUtc: null },
      { noteId: "b", at: "2030-01-02T09:00", timeZone: "UTC", repeat: "Weekly", nextAtUtc: "2030-01-02T09:00:00Z", lastSentAtUtc: null },
    ]);
    vi.spyOn(api, "note").mockImplementation(async (id) => note(id, { a: "Call the dentist", b: "Water the plants", c: "Pick up the parcel" }[id]!));
    renderPage("/reminders?note=c");

    expect(await screen.findByText("Pick up the parcel")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "The note you were reminded of" })).toHaveTextContent("Pick up the parcel");
    const today = await screen.findByRole("region", { name: "Today" });
    expect(await within(today).findByText("Call the dentist")).toBeInTheDocument();
    expect(await screen.findByText("Water the plants")).toBeInTheDocument();
    expect(screen.getByText(/Every week/)).toBeInTheDocument();
  });

  it("explains how to add one when there are none", async () => {
    vi.spyOn(api.reminders, "list").mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No reminders")).toBeInTheDocument();
  });
});
