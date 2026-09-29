import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import type { User } from "../lib/types";
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
    vi.spyOn(api, "encryption").mockResolvedValue({ mode: "AtRest", inProgress: false, totalItems: 10, remainingItems: 0 });
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user: null });
    const setEncryption = vi
      .spyOn(api, "setEncryption")
      .mockResolvedValue({ mode: "Off", inProgress: true, totalItems: 10, remainingItems: 7 });
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch", { name: "Encrypt my notes and attachments" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    await user.click(toggle);

    expect(await screen.findByRole("dialog", { name: "Turn off encryption at rest?" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith("Off", proof));
    expect(proveIdentity).toHaveBeenCalledWith("maple", "correct horse battery staple");
    expect(await screen.findByRole("progressbar", { name: "Conversion progress" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
  });

  it("keeps the dialog open and explains a wrong password", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api, "encryption").mockResolvedValue({ mode: "AtRest", inProgress: false, totalItems: 0, remainingItems: 0 });
    vi.spyOn(api, "setEncryption").mockRejectedValue(new ApiError(400, { errors: { password: ["The password is not correct."] } }));
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch", { name: "Encrypt my notes and attachments" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await user.type(await screen.findByLabelText("Your password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    expect(await screen.findByText("The password is not correct.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows end-to-end mode without the at-rest switch", async () => {
    vi.spyOn(api, "encryption").mockResolvedValue({ mode: "EndToEnd", inProgress: false, totalItems: 3, remainingItems: 0 });
    renderSection({ ...user, encryptionMode: "EndToEnd", hasEndToEndKey: true });

    expect(await screen.findByRole("heading", { name: "End-to-end encryption is on" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
