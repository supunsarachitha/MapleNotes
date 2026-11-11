import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { auth, TwoFactorRequired } from "../lib/auth";
import { PasskeyCancelled } from "../lib/passkeys";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { User } from "../lib/types";
import { AuthPage } from "./AuthPage";

const user: User = {
  id: "u",
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
  twoFactorEnabled: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("sign-in with two-factor sign-in", () => {
  it("asks for the code after the right password, shows a wrong one, and signs in with the right one", async () => {
    const complete = vi
      .fn<(code: string) => Promise<User>>()
      .mockRejectedValueOnce(new ApiError(401, { title: "That code is not correct.", twoFactorRequired: true }))
      .mockResolvedValueOnce(user);
    const signIn = vi.spyOn(auth, "signIn").mockRejectedValue(new TwoFactorRequired(complete));
    window.history.replaceState(null, "", "/login");
    const person = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthPage mode="login" registrationOpen={false} />
      </QueryClientProvider>,
    );

    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Two-factor sign-in" })).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(1);
    await person.type(screen.getByLabelText("Authentication code"), "111111");
    await person.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That code is not correct.")).toBeInTheDocument();
    await person.type(screen.getByLabelText("Authentication code"), "123456");
    await person.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(complete.mock.calls).toEqual([["111111"], ["123456"]]);
    expect(signIn).toHaveBeenCalledTimes(1); // the password was not derived again
  });
});

describe("sign-in with a passkey", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderLogin() {
    vi.stubGlobal("PublicKeyCredential", class {});
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "credentials", { value: { create: vi.fn(), get: vi.fn() }, configurable: true });
    window.history.replaceState(null, "", "/login");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthPage mode="login" registrationOpen={false} />
      </QueryClientProvider>,
    );
  }

  it("signs in from the button with the request fetched in advance", async () => {
    const options = { challengeId: "r1", challenge: "AQ==", rpId: "localhost", timeoutMs: 1000 };
    vi.spyOn(api.passkeys, "signInOptions").mockResolvedValue(options);
    const signIn = vi.spyOn(auth, "signInWithPasskey").mockResolvedValue(user);
    renderLogin();

    await waitFor(() => expect(api.passkeys.signInOptions).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(signIn).toHaveBeenCalledWith(true, { options });
  });

  it("shows why a passkey was refused, and says nothing when the prompt is closed", async () => {
    vi.spyOn(api.passkeys, "signInOptions").mockResolvedValue({ challengeId: "r", challenge: "AQ==", rpId: "localhost", timeoutMs: 1 });
    vi.spyOn(auth, "signInWithPasskey")
      .mockRejectedValueOnce(new PasskeyCancelled())
      .mockRejectedValueOnce(new ApiError(401, { title: "This passkey could not sign you in." }));
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    expect(await screen.findByText("This passkey could not sign you in.")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("has no passkey button where the browser cannot use passkeys", () => {
    window.history.replaceState(null, "", "/login");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthPage mode="login" registrationOpen={false} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
  });
});

describe("first-run setup", () => {
  afterEach(() => localStorage.clear());

  it("marks this device to suggest requiring a second factor for administrators", async () => {
    vi.spyOn(auth, "register").mockResolvedValue(user);
    const person = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthPage mode="setup" registrationOpen />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Settings → Administration suggests requiring two-factor sign-in or a passkey/)).toBeInTheDocument();
    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText(/^Password/), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(localStorage.getItem("maple.suggestSecondFactor")).toBe("1"));
  });

  it("does not mark devices that only register an account", async () => {
    vi.spyOn(auth, "register").mockResolvedValue(user);
    const person = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthPage mode="register" registrationOpen />
      </QueryClientProvider>,
    );

    await person.type(screen.getByLabelText("Username"), "maple");
    await person.type(screen.getByLabelText(/^Password/), "correct horse battery staple");
    await person.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(auth.register).toHaveBeenCalled());
    expect(localStorage.getItem("maple.suggestSecondFactor")).toBeNull();
  });
});
