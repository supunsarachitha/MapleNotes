import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { askToConfirm } from "../lib/confirmation";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { User } from "../lib/types";
import { ConfirmationPrompt } from "./ConfirmIdentityDialog";

const account: User = {
  id: "u1",
  username: "maple",
  displayName: "Maple",
  role: "Admin",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

function renderPrompt(user: User = account) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfirmationPrompt user={user} />
    </QueryClientProvider>,
  );
}

describe("ConfirmationPrompt", () => {
  it("opens when a request needs confirmation and confirms with a proof of the password", async () => {
    const prove = vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    const confirm = vi.spyOn(api.confirmation, "confirm").mockResolvedValue({ confirmedUntilUtc: "2026-11-12T22:40:00Z" });
    const person = userEvent.setup();
    renderPrompt();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const answer = askToConfirm();
    await person.type(await screen.findByLabelText("Your password"), "correct horse battery");
    await person.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await answer).toBe(true);
    expect(prove).toHaveBeenCalledWith("maple", "correct horse battery");
    expect(confirm).toHaveBeenCalledWith({ proof: { authKey: "derived-key" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the prompt open with the server's message when the password is wrong", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "wrong" });
    vi.spyOn(api.confirmation, "confirm").mockRejectedValue(
      new ApiError(400, { title: "Invalid", errors: { password: ["The password is not correct."] } }),
    );
    const person = userEvent.setup();
    renderPrompt();

    void askToConfirm();
    await person.type(await screen.findByLabelText("Your password"), "nope nope nope");
    await person.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("The password is not correct.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers an authenticator code when two-factor sign-in is on", async () => {
    const confirm = vi.spyOn(api.confirmation, "confirm").mockResolvedValue({ confirmedUntilUtc: "2026-11-12T22:40:00Z" });
    const person = userEvent.setup();
    renderPrompt({ ...account, twoFactorEnabled: true });

    const answer = askToConfirm();
    await person.click(await screen.findByRole("button", { name: "Use an authenticator code instead" }));
    await person.type(screen.getByLabelText("Authenticator or recovery code"), " 123456 ");
    await person.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await answer).toBe(true);
    expect(confirm).toHaveBeenCalledWith({ code: "123456" });
  });

  it("does not offer a code when two-factor sign-in is off", async () => {
    renderPrompt();
    void askToConfirm();
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /authenticator code/ })).not.toBeInTheDocument();
  });

  it("answers no when the person cancels", async () => {
    const confirm = vi.spyOn(api.confirmation, "confirm");
    const person = userEvent.setup();
    renderPrompt();

    const answer = askToConfirm();
    await person.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await answer).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
