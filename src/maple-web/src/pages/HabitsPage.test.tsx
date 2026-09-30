import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Preferences } from "../lib/types";
import { HabitsPage } from "./HabitsPage";

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

describe("Habits", () => {
  it("says when the habit tracker is turned off, as it is by default", () => {
    renderWith(<HabitsPage />);

    expect(screen.getByText("The habit tracker is turned off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn it on in Settings." })).toHaveAttribute("href", "/settings");
  });

  it("shows the page when the habit tracker is on", () => {
    renderWith(<HabitsPage />, { habitTracker: true });

    expect(screen.getByRole("heading", { name: "Habits" })).toBeInTheDocument();
    expect(screen.queryByText("The habit tracker is turned off")).not.toBeInTheDocument();
  });
});
