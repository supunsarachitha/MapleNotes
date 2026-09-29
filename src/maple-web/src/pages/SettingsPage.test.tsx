import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, EncryptionStatus, User } from "../lib/types";
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
  client.setQueryData<AuthStatus>(queryKeys.status, { setupRequired: false, registrationOpen: false, user });
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

  it("changes writing preferences", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });
    const dateInTitles = screen.getByRole("switch", { name: "Start titles with today's date" });

    expect(dateInTitles).toBeDisabled(); // needs titles
    await userEvent.click(screen.getByRole("switch", { name: "Note titles" }));
    await waitFor(() => expect(dateInTitles).toBeEnabled());
    await userEvent.click(dateInTitles);
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "MMM d, yyyy");

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, noteTitles: true, dateInTitles: true, dateFormat: "MMM d, yyyy" }),
    );
    expect(screen.getByRole("switch", { name: "Note titles" })).toHaveAttribute("aria-checked", "true");
  });
});
