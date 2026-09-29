import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { EncryptionStatus, User } from "../lib/types";
import { SettingsPage } from "./SettingsPage";

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

function renderSettings(status: EncryptionStatus) {
  vi.spyOn(api, "encryption").mockResolvedValue(status);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPage user={user} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Settings", () => {
  it("keeps encryption, sessions and account deletion in a collapsed Advanced section", async () => {
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 3, remainingItems: 0 });
    const advanced = screen.getByRole("button", { name: /^Advanced/ });

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Encryption" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Backup & restore" })).toBeInTheDocument();

    await userEvent.click(advanced);

    expect(advanced).toHaveAttribute("aria-expanded", "true");
    const content = document.getElementById(advanced.getAttribute("aria-controls")!)!;
    for (const name of ["Encryption", "Sessions", "Delete account"]) {
      expect(within(content).getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("opens the Advanced section by itself while a conversion is running", async () => {
    renderSettings({ mode: "AtRest", inProgress: true, totalItems: 10, remainingItems: 4 });

    expect(await screen.findByRole("heading", { name: "Encryption" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Advanced/ })).toHaveAttribute("aria-expanded", "true");
  });
});
