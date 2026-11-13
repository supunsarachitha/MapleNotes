import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AdminUser, AuthStatus, EncryptionStatus, InstanceSettings, Label, Passkey, PasskeyCreationOptions, SignedInSession, User } from "../lib/types";
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

/** Renders Settings at an address: /settings, or one section such as /settings/notes. */
function renderSettings(status: EncryptionStatus, account: User = user, quotaBytes: number | null = null, path = "/settings") {
  window.history.replaceState(null, "", path);
  vi.spyOn(api, "encryption").mockResolvedValue(status);
  if (!vi.isMockFunction(api.passkeys.list)) vi.spyOn(api.passkeys, "list").mockResolvedValue([]);
  if (!vi.isMockFunction(api.sessions)) vi.spyOn(api, "sessions").mockResolvedValue([]);
  vi.spyOn(api.twoFactor, "status").mockResolvedValue({ enabled: account.twoFactorEnabled ?? false, recoveryCodesLeft: account.twoFactorEnabled ? 10 : 0 });
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

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const idle: EncryptionStatus = { mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 };

function mockAdmin(settings: InstanceSettings) {
  vi.spyOn(api.admin, "settings").mockResolvedValue(settings);
  vi.spyOn(api.admin, "users").mockResolvedValue([]);
  vi.spyOn(api.admin, "storage").mockResolvedValue({ databaseBytes: 1, filesBytes: 1, backupsBytes: 0, freeBytes: null, totalBytes: 2 });
}

describe("Settings", () => {
  it("opens Notes & files at the old Features address", () => {
    renderSettings(idle, user, null, "/settings/features");
    expect(screen.getByRole("heading", { level: 1, name: "Notes & files" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Trash" })).toBeInTheDocument();
  });

  it("lists its sections, shows Account first, and opens a section from the list", async () => {
    renderSettings(idle);
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(sections.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/settings/account", "/settings/appearance", "/settings/menu", "/settings/writing", "/settings/notes", "/settings/notifications", "/settings/labels",
      "/settings/data", "/settings/security", "/settings/about",
    ]); // no Administration for members
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();

    await userEvent.click(sections.getByRole("link", { name: /^Privacy & security/ }));

    expect(window.location.pathname).toBe("/settings/security");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy & security" })).toBeInTheDocument();
    for (const name of ["Password", "Two-factor sign-in", "Encryption", "Sessions"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(sections.getByRole("link", { name: /^Privacy & security/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings"); // back, on phones
  });

  it("keeps account deletion with the account, and starting over with backups", () => {
    renderSettings(idle, user, null, "/settings/account");
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeInTheDocument();
    cleanup();

    renderSettings(idle, user, null, "/settings/data");
    for (const name of ["Backup & restore", "Trash", "Delete all notes and files"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Open the trash" })).toHaveAttribute("href", "/trash");
  });

  it("deletes all notes and files after the password, and the account stays signed in", async () => {
    const prove = vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    const remove = vi.spyOn(api, "deleteAllContent").mockResolvedValue({ notes: 35, files: 8 });
    const deleteAccount = vi.spyOn(api, "deleteAccount");
    renderSettings(idle, user, null, "/settings/data");

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

  it("turns on two-factor sign-in with a code from the app, then shows the recovery codes once", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api.twoFactor, "setup").mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/Maple%20Notes%3Amaple?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Maple%20Notes",
    });
    const codes = Array.from({ length: 10 }, (_, i) => `abcde-fgh${i + 2}k`);
    const enable = vi.spyOn(api.twoFactor, "enable").mockResolvedValue(codes);
    renderSettings(idle, user, null, "/settings/security");

    await userEvent.click(screen.getByRole("button", { name: "Turn on two-factor sign-in…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Turn on two-factor sign-in" }));
    expect(await dialog.findByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(dialog.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Open in authenticator app" })).toHaveAttribute("href", expect.stringMatching(/^otpauth:\/\/totp\//));
    await userEvent.type(dialog.getByLabelText("Code from the app"), "123456");
    await userEvent.type(dialog.getByLabelText("Your password"), "correct horse battery staple");
    await userEvent.click(dialog.getByRole("button", { name: "Turn on" }));

    const saved = within(await screen.findByRole("dialog", { name: "Save your recovery codes" }));
    expect(enable).toHaveBeenCalledWith({ proof: { authKey: "derived-key" }, secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", code: "123456" });
    expect(within(saved.getByRole("list", { name: "Recovery codes" })).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(saved.getByRole("button", { name: "I saved them" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("turns two-factor sign-in off with the password and a code", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    const disable = vi.spyOn(api.twoFactor, "disable").mockResolvedValue();
    renderSettings(idle, { ...user, twoFactorEnabled: true }, null, "/settings/security");

    expect(await screen.findByText("10 recovery codes left.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn off…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Turn off two-factor sign-in?" }));
    await userEvent.type(dialog.getByLabelText("Code from your app, or a recovery code"), "abcde-fghjk");
    await userEvent.type(dialog.getByLabelText("Your password"), "correct horse battery staple");
    await userEvent.click(dialog.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(disable).toHaveBeenCalledWith({ proof: { authKey: "derived-key" }, code: "abcde-fghjk" }));
    expect(await screen.findByText("Two-factor sign-in is off.")).toBeInTheDocument();
  });

  it("shows in the list of sections that notes are being converted", async () => {
    renderSettings({ mode: "AtRest", inProgress: true, totalItems: 10, remainingItems: 4 });

    expect(await screen.findByRole("link", { name: /^Privacy & security.*\(converting your notes\)/ })).toBeInTheDocument();
  });

  it("changes writing preferences", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/writing");
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

  it("hides and shows side menu items with their eye, but never Home", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/menu");

    expect(screen.queryByRole("button", { name: /Home (from|in) the menu/ })).not.toBeInTheDocument();
    const todo = screen.getByRole("button", { name: "Hide Todo from the menu" });
    expect(todo).toHaveAttribute("aria-pressed", "false"); // shown by default
    await userEvent.click(todo);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, todoLists: false }));
    expect(screen.getByRole("button", { name: "Show Todo in the menu" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers a photo size once photos are shrunk", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/notes");

    expect(screen.queryByRole("group", { name: "Photo size" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Shrink photos before uploading" }));
    const sizes = within(await screen.findByRole("group", { name: "Photo size" }));
    expect(sizes.getByRole("radio", { name: /^Large/ })).toBeChecked(); // as before sizes could be chosen
    await userEvent.click(sizes.getByRole("radio", { name: /^Small/ }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, shrinkPhotos: true, photoSize: "Small" }));
    expect(screen.getByText(/at most 1,280 pixels on the longest side/)).toBeInTheDocument();
  });

  it("offers the habit tracker, off by default", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/menu");

    await userEvent.click(screen.getByRole("button", { name: "Show Habits in the menu" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, habitTracker: true }));
    expect(screen.getByRole("button", { name: "Hide Habits from the menu" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers double-tap to edit, off by default", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/writing");
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

  it("changes the note and menu text sizes, the first day of the week, the Archive and Tags pages, and Help in the menu", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/appearance");
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));

    await userEvent.click(within(screen.getByRole("group", { name: "Note text size" })).getByRole("radio", { name: "Small" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ noteTextSize: "Small" })));
    await userEvent.click(within(screen.getByRole("group", { name: "Menu text size" })).getByRole("radio", { name: "Large" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ menuTextSize: "Large" })));
    await userEvent.selectOptions(screen.getByLabelText("Week starts on"), "Monday");
    await userEvent.click(sections.getByRole("link", { name: /^Side menu/ }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ weekStart: "Monday" })));
    await userEvent.click(screen.getByRole("button", { name: "Hide Archive from the menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide Tags from the menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide Help from the menu" }));

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        ...DEFAULT_PREFERENCES,
        noteTextSize: "Small",
        menuTextSize: "Large",
        weekStart: "Monday",
        archive: false,
        tags: false,
        helpMenu: false,
      }),
    );
  });

  it("lets administrators rename the app", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

    await userEvent.type(await screen.findByLabelText("App name"), "Family Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: "Family Notes", sessionDays: 30 }));
    expect(await screen.findByText("The app is now called Family Notes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose icon…" })).toBeInTheDocument();
  });

  it("changes the theme and accent colour", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/appearance");

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
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");
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

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: 1536, appName: null, sessionDays: 30 }));
    expect(await screen.findByText("Each account can now store up to 1.5 GB.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Storage limit" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the storage limit when registration changes, and removes it with its switch", async () => {
    mockAdmin({ allowRegistration: true, storageQuotaMb: 2048, appName: null, sessionDays: 30 });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");
    const limit = await screen.findByRole("switch", { name: "Storage limit" });
    expect(limit).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Per account")).toHaveValue(2);

    await userEvent.click(screen.getByRole("switch", { name: "Open registration" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ allowRegistration: false, storageQuotaMb: 2048, appName: null, sessionDays: 30 }));

    await userEvent.click(screen.getByRole("switch", { name: "Storage limit" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 }));
    expect(await screen.findByText("Storage limit removed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Per account")).not.toBeInTheDocument();
  });

  it("lets administrators choose how long devices stay signed in", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

    const length = await screen.findByRole("combobox", { name: "Stay signed in for" });
    expect(length).toHaveValue("30");
    await userEvent.selectOptions(length, "400");

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 400 }));
    expect(await screen.findByText(/stay signed in for 400 days/i)).toBeInTheDocument();
  });

  it("lets administrators compact the database", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    const compact = vi.spyOn(api.admin, "compactDatabase").mockResolvedValue({ bytesBefore: 12 * 1024 * 1024, bytesAfter: 3 * 1024 * 1024 });
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

    await userEvent.click(await screen.findByRole("button", { name: "Compact database" }));

    expect(await screen.findByText("Database compacted from 12 MB to 3.0 MB.")).toBeInTheDocument();
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it("shows administrators the server's totals", async () => {
    vi.spyOn(api.admin, "settings").mockResolvedValue({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    vi.spyOn(api.admin, "users").mockResolvedValue([]);
    vi.spyOn(api.admin, "storage").mockResolvedValue({
      databaseBytes: 2 * 1024 * 1024, filesBytes: 40 * 1024 * 1024, backupsBytes: 6 * 1024 * 1024, freeBytes: 20 * 1024 ** 3, totalBytes: 48 * 1024 * 1024,
    });
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

    expect(await screen.findByText(/Maple Notes uses 48 MB/)).toHaveTextContent("20 GB free on its volume");
    expect(screen.getByText("Database 2.0 MB · Files 40 MB · Backups 6.0 MB")).toBeInTheDocument();
  });

  it("rearranges the side menu with each item's arrows, and goes back to the usual order", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/menu");
    const items = () => within(screen.getByRole("list", { name: "Menu items in order" })).getAllByRole("listitem").map((item) => item.textContent);

    expect(screen.getByRole("button", { name: "Move Home up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Help down" })).toBeDisabled();
    expect(items()[3]).toContain("Hidden"); // keeps its place for when it is turned on
    await userEvent.click(screen.getByRole("button", { name: "Move Todo up" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, menuOrder: "todo,home,quick,habits,reminders,tags,archive,help" }));
    expect(items()[0]).toContain("Todo");
    expect(screen.getByText("Todo moved to position 1 of 8.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to the usual order" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(DEFAULT_PREFERENCES));
  });

  it("offers tag suggestions, labels and the trash", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/writing");
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));

    await userEvent.click(screen.getByRole("switch", { name: "Suggest tags while typing" }));
    await userEvent.click(sections.getByRole("link", { name: /^Notes & files/ }));
    expect(screen.getByRole("switch", { name: "Trash" })).toHaveAttribute("aria-checked", "true"); // on by default
    await userEvent.click(sections.getByRole("link", { name: /^Labels/ }));
    expect(screen.getByRole("switch", { name: "Use labels" })).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("switch", { name: "Use labels" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, tagSuggestions: true, labels: true }));
  });

  it("hides a label's notes from Home and Quick notes, and shows them again", async () => {
    let labels: Label[] = [{ id: "l-private", name: "Private", color: "Purple", noteCount: 2 }];
    vi.spyOn(api.labels, "list").mockImplementation(async () => labels);
    const update = vi.spyOn(api.labels, "update").mockImplementation(async (id, changes) => {
      labels = labels.map((label) => (label.id === id ? { ...label, ...changes } : label));
      return labels.find((label) => label.id === id)!;
    });
    renderSettings(idle, { ...user, preferences: { ...DEFAULT_PREFERENCES, labels: true } }, null, "/settings/labels");

    const hide = await screen.findByRole("button", { name: "Hide notes labelled Private from Home and Quick notes" });
    expect(hide).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(hide);
    await waitFor(() => expect(update).toHaveBeenCalledWith("l-private", { hideNotes: true }));
    expect(await screen.findByText("Notes hidden")).toBeInTheDocument();
    const show = screen.getByRole("button", { name: "Show notes labelled Private on Home and in Quick notes" });
    expect(show).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(show);

    await waitFor(() => expect(update).toHaveBeenLastCalledWith("l-private", { hideNotes: false }));
    await waitFor(() => expect(screen.queryByText("Notes hidden")).not.toBeInTheDocument());
  });

  it("creates, recolours, renames and deletes labels", async () => {
    let labels: Label[] = [{ id: "l-work", name: "Work", color: "Blue", noteCount: 3 }];
    vi.spyOn(api.labels, "list").mockImplementation(async () => labels);
    const create = vi.spyOn(api.labels, "create").mockImplementation(async (name, color) => {
      const label: Label = { id: "l-home", name, color, noteCount: 0 };
      labels = [...labels, label];
      return label;
    });
    const update = vi.spyOn(api.labels, "update").mockImplementation(async (id, changes) => {
      labels = labels.map((label) => (label.id === id ? { ...label, ...changes } : label));
      return labels.find((label) => label.id === id)!;
    });
    const remove = vi.spyOn(api.labels, "remove").mockImplementation(async (id) => {
      labels = labels.filter((label) => label.id !== id);
    });
    renderSettings(idle, { ...user, preferences: { ...DEFAULT_PREFERENCES, labels: true } }, null, "/settings/labels");
    const list = await screen.findByRole("list", { name: "Your labels" });
    expect(within(list).getByRole("link", { name: "3 notes" })).toHaveAttribute("href", "/?label=l-work");

    await userEvent.type(screen.getByRole("textbox", { name: "New label name" }), "work");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("You already have a label called “work”.");
    await userEvent.clear(screen.getByRole("textbox", { name: "New label name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New label name" }), "Home");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Home", expect.any(String)));
    expect(await screen.findByText("Home")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Colour of Work: Blue" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Green" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("l-work", { color: "Green" }));

    await userEvent.click(screen.getByRole("button", { name: "Rename Work" }));
    const name = screen.getByRole("textbox", { name: "New name for Work" });
    expect(name).toHaveFocus();
    await userEvent.type(name, " trips{Enter}");
    await waitFor(() => expect(update).toHaveBeenCalledWith("l-work", { name: "Work trips" }));

    await userEvent.click(await screen.findByRole("button", { name: "Delete Work trips" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the label “Work trips”?" });
    expect(dialog).toHaveTextContent("It comes off its 3 notes. The notes themselves stay as they are.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete label" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("l-work"));
    expect(await screen.findByText("Label “Work trips” deleted.")).toBeInTheDocument();
  });

  it("shows Administration to administrators only", () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30 });
    renderSettings(idle, { ...user, role: "Admin" });

    expect(screen.getByRole("link", { name: /^Administration/ })).toHaveAttribute("href", "/settings/admin");
  });
});

describe("passkeys", () => {
  const passkey: Passkey = {
    id: "p1", name: "Phone", backedUp: true, createdAtUtc: "2026-11-01T10:00:00Z", lastUsedAtUtc: null, credentialId: "AQ==", unlocksNotes: false,
  };
  const options: PasskeyCreationOptions = {
    challengeId: "c1", challenge: "AQ==", rp: { id: "localhost", name: "Maple Notes" },
    user: { id: "AQ==", name: "maple", displayName: "Maple" }, algorithms: [-7], excludeCredentials: [], timeoutMs: 1000,
  };

  afterEach(() => vi.unstubAllGlobals());

  it("adds a passkey with a name and the password, and lists it", async () => {
    vi.stubGlobal("PublicKeyCredential", class {});
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "credentials", { value: { create: vi.fn(), get: vi.fn() }, configurable: true });
    vi.spyOn(api.passkeys, "list").mockResolvedValueOnce([]).mockResolvedValue([passkey]);
    vi.spyOn(api.passkeys, "creationOptions").mockResolvedValue(options);
    const add = vi.spyOn(auth, "addPasskey").mockResolvedValue({ passkey, canUnlockWithTap: false });
    renderSettings(idle, user, null, "/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add a passkey" }));
    await userEvent.type(dialog.getByLabelText("Name (optional)"), "Phone");
    await userEvent.type(dialog.getByLabelText("Your password"), "correct horse battery staple");
    await waitFor(() => expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled());
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));

    expect(add).toHaveBeenCalledWith(user, "correct horse battery staple", options, "Phone");
    const list = within(await screen.findByRole("list", { name: "Passkeys" }));
    expect(list.getByText("Phone")).toBeInTheDocument();
    expect(list.getByText("Added 2026-11-01")).toBeInTheDocument();
    expect(list.getByText("Synced")).toBeInTheDocument();
    expect(list.getByText("Not used yet")).toBeInTheDocument();
  });

  it("removes a passkey after the password", async () => {
    vi.spyOn(api.passkeys, "list").mockResolvedValue([passkey]);
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    const remove = vi.spyOn(api.passkeys, "remove").mockResolvedValue();
    renderSettings(idle, user, null, "/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Remove Phone" }));
    const dialog = within(screen.getByRole("dialog", { name: "Remove this passkey?" }));
    await userEvent.type(dialog.getByLabelText("Your password"), "correct horse battery staple");
    await userEvent.click(dialog.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("p1", { authKey: "derived-key" }));
  });

  it("explains when the browser cannot add passkeys", async () => {
    renderSettings(idle, user, null, "/settings/security");
    expect(await screen.findByText(/This browser cannot add passkeys here/)).toBeInTheDocument();
  });
});

describe("trash retention", () => {
  it("chooses how long deleted notes are kept, and hides the choice while the trash is off", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/notes");

    await userEvent.selectOptions(screen.getByLabelText("Keep deleted notes"), "Until I empty the trash");
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ trashDays: 0 })));
    cleanup();

    renderSettings(idle, { ...user, preferences: { ...user.preferences, trash: false } }, null, "/settings/notes");
    expect(screen.queryByLabelText("Keep deleted notes")).not.toBeInTheDocument();
  });
});

describe("time zone", () => {
  it("offers Automatic with this device's zone, and saves a chosen one", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/appearance");

    const select = screen.getByLabelText("Time zone");
    expect(select).toHaveValue("");
    expect(within(select).getByRole("option", { name: /^Automatic \(this device: / })).toBeInTheDocument();
    await userEvent.selectOptions(select, "Asia/Colombo");
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: "Asia/Colombo" })));
  });
});

describe("signed-in devices", () => {
  const sessions: SignedInSession[] = [
    {
      id: "s-here", device: "Firefox on Linux", ipAddress: "203.0.113.5", createdAtUtc: "2026-11-01T08:00:00Z",
      lastSeenAtUtc: "2026-11-10T08:00:00Z", expiresAtUtc: "2027-01-30T08:00:00Z", current: true, newDevice: false,
    },
    {
      id: "s-phone", device: "Safari on iOS", ipAddress: null, createdAtUtc: "2026-10-20T08:00:00Z",
      lastSeenAtUtc: "2026-11-09T08:00:00Z", expiresAtUtc: "2027-01-18T08:00:00Z", current: false, newDevice: true,
    },
  ];

  it("lists every signed-in device and marks this one", async () => {
    vi.spyOn(api, "sessions").mockResolvedValue(sessions);
    renderSettings(idle, user, null, "/settings/security");

    const list = await screen.findByRole("list", { name: "Signed-in devices" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveTextContent("Firefox on LinuxThis device");
    expect(rows[0]!).toHaveTextContent("203.0.113.5");
    expect(within(rows[1]!).queryByText("This device")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText("New device")).toBeInTheDocument();
    expect(within(rows[0]!).queryByText("New device")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: "Sign out Safari on iOS" })).toBeInTheDocument();
  });

  it("signs another device out and refreshes the list", async () => {
    const list = vi.spyOn(api, "sessions").mockResolvedValueOnce(sessions).mockResolvedValue([sessions[0]!]);
    const end = vi.spyOn(api, "endSession").mockResolvedValue(undefined);
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    renderSettings(idle, user, null, "/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Sign out Safari on iOS" }));

    expect(end).toHaveBeenCalledWith("s-phone");
    expect(logout).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Safari on iOS")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("signs this device out through the normal sign-out", async () => {
    vi.spyOn(api, "sessions").mockResolvedValue(sessions);
    const end = vi.spyOn(api, "endSession").mockResolvedValue(undefined);
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user: null });
    renderSettings(idle, user, null, "/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Sign out Firefox on Linux (this device)" }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(end).not.toHaveBeenCalled();
  });
});

describe("second-factor rule", () => {
  const admin: User = { ...user, role: "Admin" };
  const self: AdminUser = {
    id: admin.id, username: "maple", displayName: "Maple", role: "Admin", isDisabled: false, noteCount: 0, createdAtUtc: "2026-09-29T08:00:00Z",
  };
  const base: InstanceSettings = { allowRegistration: false, storageQuotaMb: null, appName: null, sessionDays: 30, requireSecondFactor: "Off" };

  afterEach(() => localStorage.clear());

  it("lets administrators with a second factor require one for everyone", async () => {
    mockAdmin(base);
    vi.spyOn(api.admin, "users").mockResolvedValue([{ ...self, twoFactorEnabled: true }]);
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, admin, null, "/settings/admin");

    const rule = await screen.findByRole("combobox", { name: "Require two-factor sign-in or a passkey for" });
    expect(rule).toHaveValue("Off");
    await waitFor(() => expect(within(rule).getByRole("option", { name: "Everyone" })).toBeEnabled());
    await userEvent.selectOptions(rule, "Everyone");

    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...base, requireSecondFactor: "Everyone" }));
    expect(await screen.findByText("Every account now needs two-factor sign-in or a passkey.")).toBeInTheDocument();
  });

  it("explains that an administrator needs a second factor of their own first", async () => {
    mockAdmin(base);
    vi.spyOn(api.admin, "users").mockResolvedValue([self]);
    renderSettings(idle, admin, null, "/settings/admin");

    const rule = await screen.findByRole("combobox", { name: "Require two-factor sign-in or a passkey for" });
    await waitFor(() => expect(within(rule).getByRole("option", { name: "Administrators" })).toBeDisabled());
    expect(within(rule).getByRole("option", { name: "Everyone" })).toBeDisabled();
    expect(screen.getByText(/You need one on your own account before you can require it/)).toBeInTheDocument();
  });

  it("explains why two-factor sign-in cannot be turned off for an account the rule covers", async () => {
    mockAdmin({ ...base, requireSecondFactor: "Everyone" });
    vi.spyOn(api.admin, "users").mockResolvedValue([
      { ...self, twoFactorEnabled: true },
      { ...self, id: "a", username: "alder", displayName: "Alder", role: "User", twoFactorEnabled: true },
      { ...self, id: "b", username: "birch", displayName: "Birch", role: "User", twoFactorEnabled: true, hasPasskey: true },
      { ...self, id: "c", username: "cedar", displayName: "Cedar", role: "User" },
    ]);
    renderSettings(idle, admin, null, "/settings/admin");

    const alder = (await screen.findByText("@alder")).closest("li")!;
    expect(within(alder).queryByRole("button", { name: "Turn off two-factor" })).not.toBeInTheDocument();
    expect(within(alder).getByText(/cannot be turned off here: this server requires a second factor/)).toBeInTheDocument();
    // A passkey is a second factor too, so two-factor sign-in is not the last one.
    const birch = screen.getByText("@birch").closest("li")!;
    expect(within(birch).getByRole("button", { name: "Turn off two-factor" })).toBeInTheDocument();
    expect(within(birch).getByText("· Passkey")).toBeInTheDocument();
    expect(within(screen.getByText("@cedar").closest("li")!).getByText("· Must set up a second factor")).toBeInTheDocument();
  });

  it("suggests requiring it for administrators on a server this device just set up", async () => {
    localStorage.setItem("maple.suggestSecondFactor", "1");
    mockAdmin(base);
    vi.spyOn(api.admin, "users").mockResolvedValue([{ ...self, hasPasskey: true }]);
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, admin, null, "/settings/admin");

    expect(await screen.findByText("Suggested for a new server: require a second factor for administrators.")).toBeInTheDocument();
    const accept = screen.getByRole("button", { name: "Require for administrators" });
    await waitFor(() => expect(accept).toBeEnabled());
    await userEvent.click(accept);

    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...base, requireSecondFactor: "Administrators" }));
    expect(screen.queryByText(/Suggested for a new server/)).not.toBeInTheDocument();
    expect(localStorage.getItem("maple.suggestSecondFactor")).toBeNull();
  });

  it("does not suggest it elsewhere", async () => {
    mockAdmin(base);
    vi.spyOn(api.admin, "users").mockResolvedValue([self]);
    renderSettings(idle, admin, null, "/settings/admin");

    await screen.findByRole("combobox", { name: "Require two-factor sign-in or a passkey for" });
    expect(screen.queryByText(/Suggested for a new server/)).not.toBeInTheDocument();
  });
});
