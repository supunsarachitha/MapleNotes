import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openModeRecord } from "../crypto/content";
import { importDataKey } from "../crypto/datakey";
import { fromBase64 } from "../crypto/encoding";
import v from "../crypto/test-vectors.json";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { TrustedModeContext, type TrustedMode } from "../lib/modeRecord";
import { setContentSession } from "../lib/noteCrypto";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { EncryptionStatus, User } from "../lib/types";
import { EncryptionSection } from "./EncryptionSection";

const user: User = {
  id: "0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d",
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

const status = (mode: EncryptionStatus["mode"], remainingItems = 0, totalItems = 10): EncryptionStatus => ({
  mode,
  inProgress: remainingItems > 0,
  totalItems,
  remainingItems,
});

function renderSection(account: User = user, trusted: TrustedMode | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrustedModeContext.Provider value={trusted}>
        <EncryptionSection user={account} />
      </TrustedModeContext.Provider>
    </QueryClientProvider>,
  );
}

/** Unlocks the account's end-to-end key in this "browser", as the app does after sign-in. */
async function unlock(account: User) {
  const keys = await importDataKey(fromBase64(v.dataKeyB64));
  setContentSession({ userId: account.id, mode: account.encryptionMode, keys });
  return keys;
}

afterEach(() => {
  setContentSession(null);
  localStorage.clear();
});

describe("EncryptionSection", () => {
  it("asks for the password before switching, then shows conversion progress", async () => {
    const proof = { authKey: "derived-key" };
    const proveIdentity = vi.spyOn(auth, "proveIdentity").mockResolvedValue(proof);
    vi.spyOn(api, "encryption").mockResolvedValue(status("AtRest"));
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user: null });
    const setEncryption = vi.spyOn(api, "setEncryption").mockResolvedValue(status("Off", 7));
    const person = userEvent.setup();
    renderSection();

    await person.click(await screen.findByRole("radio", { name: /^Off/ }));
    expect(await screen.findByRole("dialog", { name: "Turn off encryption at rest?" })).toBeInTheDocument();
    await person.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("Off", proof, undefined)); // no end-to-end key: no record
    expect(proveIdentity).toHaveBeenCalledWith("maple", "correct horse battery staple");
    expect(await screen.findByRole("progressbar", { name: "Conversion progress" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
  });

  it("keeps the dialog open and explains a wrong password", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api, "encryption").mockResolvedValue(status("AtRest"));
    vi.spyOn(api, "setEncryption").mockRejectedValue(new ApiError(400, { errors: { password: ["The password is not correct."] } }));
    const person = userEvent.setup();
    renderSection();

    await person.click(await screen.findByRole("radio", { name: /^Off/ }));
    await person.type(await screen.findByLabelText("Your password"), "wrong");
    await person.click(screen.getByRole("button", { name: "Turn off" }));

    expect(await screen.findByText("The password is not correct.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sets up end-to-end encryption and shows the recovery key before closing", async () => {
    vi.spyOn(api, "encryption").mockResolvedValue(status("AtRest"));
    const setUp = vi.spyOn(e2ee, "setUp").mockResolvedValue({ recoveryKey: "ABCD-EFGH-0000", status: status("EndToEnd", 10) });
    const person = userEvent.setup();
    renderSection();

    await person.click(await screen.findByRole("radio", { name: /^End-to-end/ }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on end-to-end encryption?" });
    await person.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled(); // not yet acknowledged
    await person.click(screen.getByLabelText(/I understand that without my password/));
    await person.click(screen.getByRole("button", { name: "Turn on" }));

    expect(setUp).toHaveBeenCalledWith(user, "correct horse battery staple");
    expect(await screen.findByLabelText("Recovery key")).toHaveTextContent("ABCD-EFGH-0000");
    await person.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Save your recovery key" })).toBeInTheDocument();
    await person.click(screen.getByLabelText("I have saved my recovery key somewhere safe."));
    await person.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("leaves end-to-end encryption after saying what that means", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api, "encryption").mockResolvedValue(status("EndToEnd"));
    const setEncryption = vi.spyOn(api, "setEncryption").mockResolvedValue(status("AtRest", 10));
    const person = userEvent.setup();
    const account: User = { ...user, encryptionMode: "EndToEnd", hasEndToEndKey: true };
    const keys = await unlock(account);
    renderSection(account);

    await person.click(await screen.findByRole("radio", { name: /^Encrypted at rest/ }));
    expect(await screen.findByText(/The server will be able to read them again/)).toBeInTheDocument();
    await person.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("AtRest", { authKey: "derived-key" }, expect.any(String)));
    // The new mode, sealed with the account's key: what the account's browsers act on (lib/modeRecord.ts).
    const record = setEncryption.mock.calls[0]![2]!;
    expect(await openModeRecord(keys, account.id, fromBase64(record))).toEqual({ mode: "AtRest", epoch: 1 });
  });

  it("keeps end-to-end encryption when the server reports a mode the owner never confirmed", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api, "encryption").mockResolvedValue(status("AtRest", 5)); // what the server says
    const setEncryption = vi.spyOn(api, "setEncryption").mockResolvedValue(status("EndToEnd"));
    const person = userEvent.setup();
    const account: User = { ...user, encryptionMode: "AtRest", hasEndToEndKey: true };
    const keys = await unlock(account);
    renderSection(account, { mode: "EndToEnd", warning: "unconfirmed" });

    expect(await screen.findByRole("alert")).toHaveTextContent("you have not confirmed that");
    expect(screen.getByRole("radio", { name: /^End-to-end/ })).toBeChecked(); // what this browser still encrypts for
    expect(screen.queryByText(/Decrypting your notes/)).not.toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Keep end-to-end encryption" }));
    await person.type(await screen.findByLabelText("Your password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Keep it" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("EndToEnd", { authKey: "derived-key" }, expect.any(String)));
    expect(await openModeRecord(keys, account.id, fromBase64(setEncryption.mock.calls[0]![2]!))).toMatchObject({ mode: "EndToEnd" });
  });
});
