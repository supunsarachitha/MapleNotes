import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Preferences, User } from "../lib/types";
import { AppShell } from "./AppShell";
import { ToastProvider } from "./Toaster";

const user: User = {
  id: "u",
  username: "maple",
  displayName: "Alex Maple",
  role: "User",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

function renderShell(preferences: Partial<Preferences>, branding?: AuthStatus["branding"]) {
  vi.spyOn(api, "listTags").mockResolvedValue([]);
  vi.spyOn(api.labels, "list").mockResolvedValue([
    { id: "l-work", name: "Work", color: "Blue", noteCount: 4 },
    { id: "l-home", name: "Home", color: "Green", noteCount: 0 },
  ]);
  vi.spyOn(api, "calendar").mockResolvedValue([]);
  const account = { ...user, preferences: { ...DEFAULT_PREFERENCES, ...preferences } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, { setupRequired: false, registrationOpen: false, user: account, branding });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AppShell user={account}>content</AppShell>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("AppShell", () => {
  it("shows the Archive and Tags pages in the menu unless they are turned off", () => {
    const { unmount } = renderShell({});
    const menu = () => screen.getByRole("navigation", { name: "Main" });
    expect(within(menu()).getByRole("link", { name: /^Tags/ })).toBeInTheDocument();
    expect(within(menu()).getByRole("link", { name: "Archive" })).toBeInTheDocument();
    unmount();

    renderShell({ archive: false, tags: false });
    expect(within(menu()).queryByRole("link", { name: /^Tags/ })).not.toBeInTheDocument();
    expect(within(menu()).queryByRole("link", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("shows the app's name and icon, and sizes the menu as the user chose", () => {
    const { container } = renderShell({ menuTextSize: "Large" }, { appName: "Family Notes", iconUrl: "/api/v1/branding/icon?v=abc" });

    expect(screen.getAllByText("Family Notes").length).toBeGreaterThan(0);
    expect(screen.queryByText("Maple Notes")).not.toBeInTheDocument();
    expect(container.querySelector('img[src="/api/v1/branding/icon?v=abc"]')).toBeInTheDocument();
    expect(container.querySelector('[data-menu="large"]')).toBeInTheDocument();
  });

  it("orders the menu as the user chose, leaving out pages that are turned off", () => {
    renderShell({ menuOrder: "help,settings,todo", habitTracker: false });

    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Help", "Settings", "Todo", "Home", "Quick notes", "Tags", "Archive"]);
  });

  it("lists the labels under the menu while labels are on", async () => {
    const { unmount } = renderShell({ labels: true });

    const labels = await screen.findByRole("navigation", { name: "Labels" });
    expect(within(labels).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Work4", "/?label=l-work"],
      ["Home", "/?label=l-home"],
    ]);
    unmount();

    renderShell({});
    expect(screen.queryByRole("navigation", { name: "Labels" })).not.toBeInTheDocument();
  });
});
