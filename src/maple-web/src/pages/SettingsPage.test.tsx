import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, EncryptionStatus, InstanceSettings, User } from "../lib/types";
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

function renderSettings(status: EncryptionStatus, account: User = user, quotaBytes: number | null = null) {
  vi.spyOn(api, "encryption").mockResolvedValue(status);
  vi.spyOn(api, "storage").mockResolvedValue({
    notesBytes: 3 * 1024, noteCount: 12, filesBytes: 5 * 1024 * 1024, fileCount: 4, totalBytes: 5 * 1024 * 1024 + 3 * 1024, quotaBytes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<AuthStatus>(queryKeys.status, { setupRequired: false, registrationOpen: false, user: account });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPage user={account} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

function mockAdmin(settings: InstanceSettings) {
  vi.spyOn(api.admin, "settings").mockResolvedValue(settings);
  vi.spyOn(api.admin, "users").mockResolvedValue([]);
  vi.spyOn(api.admin, "storage").mockResolvedValue({ databaseBytes: 1, filesBytes: 1, backupsBytes: 0, freeBytes: null, totalBytes: 2 });
}

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
    for (const name of ["Encryption", "Sessions", "Delete all notes and files", "Delete account"]) {
      expect(within(content).getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("deletes all notes and files after the password, and the account stays signed in", async () => {
    const prove = vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    const remove = vi.spyOn(api, "deleteAllContent").mockResolvedValue({ notes: 35, files: 8 });
    const deleteAccount = vi.spyOn(api, "deleteAccount");
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });

    await userEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete all notes and files…" }));
    expect(screen.getByRole("dialog", { name: "Delete all your notes and files?" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Delete everything" }));

    expect(await screen.findByText("Deleted 35 notes and 8 files.")).toBeInTheDocument();
    expect(prove).toHaveBeenCalledWith("maple", "correct horse battery staple");
    expect(remove).toHaveBeenCalledWith({ authKey: "derived-key" });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    const quickNoteTitles = screen.getByRole("switch", { name: "Titles on quick notes" });

    expect(dateInTitles).toBeDisabled(); // needs titles
    expect(quickNoteTitles).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: "Note titles" }));
    await waitFor(() => expect(dateInTitles).toBeEnabled());
    await userEvent.click(dateInTitles);
    await userEvent.click(quickNoteTitles);
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "MMM d, yyyy");

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        ...DEFAULT_PREFERENCES, noteTitles: true, dateInTitles: true, quickNoteTitles: true, dateFormat: "MMM d, yyyy",
      }),
    );
    expect(screen.getByRole("switch", { name: "Note titles" })).toHaveAttribute("aria-checked", "true");
  });

  it("turns features off and on", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });
    const todo = screen.getByRole("switch", { name: "Todo lists" });

    expect(todo).toHaveAttribute("aria-checked", "true"); // on by default
    await userEvent.click(todo);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, todoLists: false }));
    expect(todo).toHaveAttribute("aria-checked", "false");
  });

  it("offers the habit tracker, off by default", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });
    const habits = screen.getByRole("switch", { name: "Habit tracker" });

    expect(habits).toHaveAttribute("aria-checked", "false");
    await userEvent.click(habits);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, habitTracker: true }));
    expect(habits).toHaveAttribute("aria-checked", "true");
  });

  it("offers double-tap to edit, off by default", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });
    const doubleTap = screen.getByRole("switch", { name: "Double-tap to edit" });

    expect(doubleTap).toHaveAttribute("aria-checked", "false");
    await userEvent.click(doubleTap);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, doubleTapToEdit: true }));
    expect(doubleTap).toHaveAttribute("aria-checked", "true");
  });

  it("changes the display name, and an empty one goes back to the username", async () => {
    const change = vi.spyOn(api, "updateDisplayName").mockImplementation(async (displayName) => ({ ...user, displayName: displayName.trim() || user.username }));
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });

    await userEvent.click(screen.getByRole("button", { name: "Change display name" }));
    const field = screen.getByRole("textbox", { name: "Display name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Alex Maple");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Display name changed.")).toBeInTheDocument();
    expect(change).toHaveBeenCalledWith("Alex Maple");
    expect(screen.getByText("Alex Maple")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Display name" })).not.toBeInTheDocument();
  });

  it("changes the menu text size, the first day of the week, and the Archive and Tags pages", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });

    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ menuTextSize: "Large" })));
    await userEvent.selectOptions(screen.getByLabelText("Week starts on"), "Monday");
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ weekStart: "Monday" })));
    await userEvent.click(screen.getByRole("switch", { name: "Archive" }));
    await userEvent.click(screen.getByRole("switch", { name: "Tags page" }));

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, menuTextSize: "Large", weekStart: "Monday", archive: false, tags: false }),
    );
  });

  it("lets administrators rename the app", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, { ...user, role: "Admin" });

    await userEvent.type(await screen.findByLabelText("App name"), "Family Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: "Family Notes" }));
    expect(await screen.findByText("The app is now called Family Notes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose icon…" })).toBeInTheDocument();
  });

  it("changes the theme and accent colour", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("radio", { name: "Forest" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, theme: "Dark", accent: "Forest" }));
    expect(screen.getByRole("radio", { name: "Forest" })).toBeChecked();
  });

  it("shows how much the account stores, and asks nothing about the server", async () => {
    const instance = vi.spyOn(api.admin, "storage");
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });

    expect(await screen.findByText("5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("Notes 3.0 KB (12) · Files 5.0 MB (4)")).toBeInTheDocument();
    expect(instance).not.toHaveBeenCalled(); // server totals are for administrators
  });

  it("shows usage against the storage limit, and warns when it is almost or completely full", async () => {
    const used = 5 * 1024 * 1024 + 3 * 1024;
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, user, 50 * 1024 * 1024);
    expect(await screen.findByText("of 50 MB")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Notes 3.0 KB, files 5.0 MB of 50 MB" })).toBeInTheDocument();
    expect(screen.queryByText(/storage is (almost )?full/)).not.toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();

    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, user, Math.ceil(used / 0.95));
    expect(await screen.findByText("Your storage is almost full.")).toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();

    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, user, 5 * 1024 * 1024);
    expect(await screen.findByText(/^Your storage is full\./)).toBeInTheDocument();
  });

  it("lets administrators set a storage limit for every account", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, { ...user, role: "Admin" });
    const limit = await screen.findByRole("switch", { name: "Storage limit" });
    expect(limit).toHaveAttribute("aria-checked", "false");

    await userEvent.click(limit);
    const amount = screen.getByLabelText("Per account");
    expect(amount).toHaveValue(5);
    expect(screen.getByLabelText("Unit")).toHaveValue("GB");
    await userEvent.clear(amount);
    await userEvent.type(amount, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(screen.getByText("Enter an amount from 1 MB to 16 TB.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    await userEvent.clear(amount);
    await userEvent.type(amount, "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Save limit" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: 1536, appName: null }));
    expect(await screen.findByText("Each account can now store up to 1.5 GB.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Storage limit" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the storage limit when registration changes, and removes it with its switch", async () => {
    mockAdmin({ allowRegistration: true, storageQuotaMb: 2048, appName: null });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, { ...user, role: "Admin" });
    const limit = await screen.findByRole("switch", { name: "Storage limit" });
    expect(limit).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Per account")).toHaveValue(2);

    await userEvent.click(screen.getByRole("switch", { name: "Open registration" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ allowRegistration: false, storageQuotaMb: 2048, appName: null }));

    await userEvent.click(screen.getByRole("switch", { name: "Storage limit" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: null }));
    expect(await screen.findByText("Storage limit removed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Per account")).not.toBeInTheDocument();
  });

  it("lets administrators compact the database", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
    const compact = vi.spyOn(api.admin, "compactDatabase").mockResolvedValue({ bytesBefore: 12 * 1024 * 1024, bytesAfter: 3 * 1024 * 1024 });
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, { ...user, role: "Admin" });

    await userEvent.click(await screen.findByRole("button", { name: "Compact database" }));

    expect(await screen.findByText("Database compacted from 12 MB to 3.0 MB.")).toBeInTheDocument();
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it("shows administrators the server's totals", async () => {
    vi.spyOn(api.admin, "settings").mockResolvedValue({ allowRegistration: false, storageQuotaMb: null, appName: null });
    vi.spyOn(api.admin, "users").mockResolvedValue([]);
    vi.spyOn(api.admin, "storage").mockResolvedValue({
      databaseBytes: 2 * 1024 * 1024, filesBytes: 40 * 1024 * 1024, backupsBytes: 6 * 1024 * 1024, freeBytes: 20 * 1024 ** 3, totalBytes: 48 * 1024 * 1024,
    });
    renderSettings({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 }, { ...user, role: "Admin" });

    expect(await screen.findByText(/Maple Notes uses 48 MB/)).toHaveTextContent("20 GB free on its volume");
    expect(screen.getByText("Database 2.0 MB · Files 40 MB · Backups 6.0 MB")).toBeInTheDocument();
  });
});
