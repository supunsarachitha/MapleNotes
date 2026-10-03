import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api, ApiError } from "../lib/api";
import { e2ee } from "../lib/e2ee";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { User } from "../lib/types";
import { RecoverPage } from "./RecoverPage";
import { UnlockPage } from "./UnlockPage";

const user: User = {
  id: "0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d",
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "EndToEnd",
  hasEndToEndKey: true,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("unlock screen", () => {
  it("shows a wrong password and unlocks with the right one", async () => {
    const unlock = vi
      .spyOn(e2ee, "unlock")
      .mockRejectedValueOnce(new ApiError(400, { errors: { password: ["The password is not correct."] } }))
      .mockResolvedValueOnce({} as never);
    const person = userEvent.setup();
    render(withQueries(<UnlockPage user={user} />));

    await person.type(screen.getByLabelText("Password"), "wrong one");
    await person.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("The password is not correct.")).toBeInTheDocument();

    await person.clear(screen.getByLabelText("Password"));
    await person.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(unlock).toHaveBeenLastCalledWith(user, "correct horse battery staple"));
  });

  it("is shown instead of the notes when this browser does not hold the key", async () => {
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user });
    const restore = vi.spyOn(e2ee, "restore").mockResolvedValue(null);
    window.history.replaceState(null, "", "/");

    render(withQueries(<App />));

    expect(await screen.findByRole("heading", { name: "Unlock your notes" })).toBeInTheDocument();
    expect(restore).toHaveBeenCalledWith(user.id);
  });
});

describe("password reset with the recovery key", () => {
  it("shows the new recovery key and continues only after it was saved", async () => {
    const recover = vi.spyOn(e2ee, "recover").mockResolvedValue({ user, recoveryKey: "7K3M-QX2P-0000" });
    const person = userEvent.setup();
    render(withQueries(<RecoverPage />));

    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText("Recovery key"), "7k3m qx2p ....");
    await person.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await person.click(screen.getByRole("button", { name: "Reset password" }));

    expect(recover).toHaveBeenCalledWith("maple", "7k3m qx2p ....", "a brand new passphrase", undefined);
    expect(await screen.findByLabelText("Recovery key")).toHaveTextContent("7K3M-QX2P-0000");
    const next = screen.getByRole("button", { name: "Continue to my notes" });
    expect(next).toBeDisabled();
    await person.click(screen.getByLabelText("I have saved my recovery key somewhere safe."));
    expect(next).toBeEnabled();
  });

  it("explains a wrong recovery key", async () => {
    vi.spyOn(e2ee, "recover").mockRejectedValue(new ApiError(401, { title: "Incorrect username or recovery key." }));
    const person = userEvent.setup();
    render(withQueries(<RecoverPage />));

    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText("Recovery key"), "x");
    await person.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await person.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Incorrect username or recovery key.")).toBeInTheDocument();
  });

  it("asks for the two-factor code when the account uses one, then resets with it", async () => {
    const needsCode = (title: string) => new ApiError(401, { title, twoFactorRequired: true });
    const recover = vi
      .spyOn(e2ee, "recover")
      .mockRejectedValueOnce(needsCode("Enter the code from your authenticator app."))
      .mockRejectedValueOnce(needsCode("That code is not correct."))
      .mockResolvedValueOnce({ user, recoveryKey: "7K3M-QX2P-0000" });
    const person = userEvent.setup();
    render(withQueries(<RecoverPage />));

    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText("Recovery key"), "7k3m qx2p ....");
    await person.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await person.click(screen.getByRole("button", { name: "Reset password" }));

    const code = await screen.findByLabelText("Authentication code");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // asking is not an error
    await person.type(code, "111111");
    await person.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("That code is not correct.")).toBeInTheDocument();
    await person.type(screen.getByLabelText("Authentication code"), "123456");
    await person.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("button", { name: "Continue to my notes" })).toBeInTheDocument();
    expect(recover).toHaveBeenLastCalledWith("maple", "7k3m qx2p ....", "a brand new passphrase", "123456");
  });
});
