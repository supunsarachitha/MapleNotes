import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
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
};

const status = (mode: EncryptionStatus["mode"], remainingItems = 0, totalItems = 10): EncryptionStatus => ({
  mode,
  inProgress: remainingItems > 0,
  totalItems,
  remainingItems,
});

function renderSection(account: User = user) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EncryptionSection user={account} />
    </QueryClientProvider>,
  );
}

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

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("Off", proof));
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
    renderSection({ ...user, encryptionMode: "EndToEnd", hasEndToEndKey: true });

    await person.click(await screen.findByRole("radio", { name: /^Encrypted at rest/ }));
    expect(await screen.findByText(/The server will be able to read them again/)).toBeInTheDocument();
    await person.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("AtRest", { authKey: "derived-key" }));
  });
});
