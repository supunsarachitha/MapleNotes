import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { auth, TwoFactorRequired } from "../lib/auth";
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
