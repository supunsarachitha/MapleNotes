import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Preferences } from "../lib/types";
import { FeaturesSection } from "./PreferenceSections";
import { ToastProvider } from "./Toaster";

function renderFeatures(preferences: Partial<Preferences>) {
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
      <ToastProvider>
        <FeaturesSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("Sticker packs in Settings → Features", () => {
  it("has the Mood tracker and Stickers switches, off as installed, with the packs only while stickers are on", () => {
    renderFeatures({});
    expect(screen.getByRole("switch", { name: "Mood tracker" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Stickers" })).not.toBeChecked();
    expect(screen.queryByText("Sticker packs")).not.toBeInTheDocument();
  });

  it("adds a pack from a ZIP file, updates it, refuses a file that is not one, and removes it after asking", async () => {
    const user = userEvent.setup();
    renderFeatures({ stickers: true });
    expect(await screen.findByText("No sticker packs yet.")).toBeInTheDocument();
    const input = screen.getByTestId("sticker-pack-input");

    const manifest = strToU8(JSON.stringify({ name: "Falcon friends", author: "Supun", licence: "CC0-1.0" }));
    const zip = new File([zipSync({ "sticker-pack.json": manifest, "wave.png": png, "sleep.png": png })], "friends.zip");
    fireEvent.change(input, { target: { files: [zip] } });
    expect(await screen.findByText("Added “Falcon friends”: 2 stickers.")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Sticker packs" });
    expect(await within(list).findByText("Falcon friends")).toBeInTheDocument();
    expect(within(list).getByText("2 stickers · by Supun · CC0-1.0")).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File([zipSync({ "sticker-pack.json": manifest, "wave.png": png })], "again.zip")] } });
    expect(await screen.findByText("Updated “Falcon friends”: 1 sticker.")).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(["hello"], "notes.txt")] } });
    expect(await screen.findByText("notes.txt: This file is not a sticker pack. A sticker pack is a ZIP file of pictures.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Falcon friends" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove “Falcon friends”?" });
    expect(dialog).toHaveTextContent("Its stickers leave the sticker picker. Stickers already on your notes stay where they are.");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Removed “Falcon friends”.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No sticker packs yet.")).toBeInTheDocument());
  });
});
