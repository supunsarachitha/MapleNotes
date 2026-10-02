import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, EncryptionStatus, InstanceSettings, Label, User } from "../lib/types";
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

/** Renders Settings at an address: /settings, or one section such as /settings/features. */
function renderSettings(status: EncryptionStatus, account: User = user, quotaBytes: number | null = null, path = "/settings") {
  window.history.replaceState(null, "", path);
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
  it("lists its sections, shows Account first, and opens a section from the list", async () => {
    renderSettings(idle);
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(sections.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/settings/account", "/settings/appearance", "/settings/menu", "/settings/writing", "/settings/features", "/settings/labels",
      "/settings/data", "/settings/security",
    ]); // no Administration for members
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();

    await userEvent.click(sections.getByRole("link", { name: /^Privacy & security/ }));

    expect(window.location.pathname).toBe("/settings/security");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy & security" })).toBeInTheDocument();
    for (const name of ["Password", "Encryption", "Sessions"]) {
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

  it("turns features off and on", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/features");
    const todo = screen.getByRole("switch", { name: "Todo lists" });

    expect(todo).toHaveAttribute("aria-checked", "true"); // on by default
    await userEvent.click(todo);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, todoLists: false }));
    expect(todo).toHaveAttribute("aria-checked", "false");
  });

  it("offers the habit tracker, off by default", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/features");
    const habits = screen.getByRole("switch", { name: "Habit tracker" });

    expect(habits).toHaveAttribute("aria-checked", "false");
    await userEvent.click(habits);

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, habitTracker: true }));
    expect(habits).toHaveAttribute("aria-checked", "true");
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

  it("changes the menu text size, the first day of the week, the Archive and Tags pages, and Help in the menu", async () => {
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    renderSettings(idle, user, null, "/settings/menu");
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));

    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ menuTextSize: "Large" })));
    await userEvent.click(sections.getByRole("link", { name: /^Appearance/ }));
    await userEvent.selectOptions(screen.getByLabelText("Week starts on"), "Monday");
    await userEvent.click(sections.getByRole("link", { name: /^Features/ }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ weekStart: "Monday" })));
    await userEvent.click(screen.getByRole("switch", { name: "Archive" }));
    await userEvent.click(screen.getByRole("switch", { name: "Tags page" }));
    await userEvent.click(screen.getByRole("switch", { name: "Help in the menu" }));

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        ...DEFAULT_PREFERENCES,
        menuTextSize: "Large",
        weekStart: "Monday",
        archive: false,
        tags: false,
        helpMenu: false,
      }),
    );
  });

  it("lets administrators rename the app", async () => {
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

    await userEvent.type(await screen.findByLabelText("App name"), "Family Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: null, appName: "Family Notes" }));
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
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
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

    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowRegistration: false, storageQuotaMb: 1536, appName: null }));
    expect(await screen.findByText("Each account can now store up to 1.5 GB.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Storage limit" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the storage limit when registration changes, and removes it with its switch", async () => {
    mockAdmin({ allowRegistration: true, storageQuotaMb: 2048, appName: null });
    const save = vi.spyOn(api.admin, "updateSettings").mockImplementation(async (settings) => settings);
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");
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
    renderSettings(idle, { ...user, role: "Admin" }, null, "/settings/admin");

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
    expect(items()[3]).toContain("Hidden: Habit tracker is off"); // keeps its place for when it is turned on
    await userEvent.click(screen.getByRole("button", { name: "Move Todo up" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, menuOrder: "todo,home,quick,habits,tags,archive,settings,help" }));
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
    await userEvent.click(sections.getByRole("link", { name: /^Features/ }));
    expect(screen.getByRole("switch", { name: "Trash" })).toHaveAttribute("aria-checked", "true"); // on by default
    expect(screen.getByRole("switch", { name: "Labels" })).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("switch", { name: "Labels" }));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_PREFERENCES, tagSuggestions: true, labels: true }));
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
    mockAdmin({ allowRegistration: false, storageQuotaMb: null, appName: null });
    renderSettings(idle, { ...user, role: "Admin" });

    expect(screen.getByRole("link", { name: /^Administration/ })).toHaveAttribute("href", "/settings/admin");
  });
});
