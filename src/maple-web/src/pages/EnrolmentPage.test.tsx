import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ToastProvider } from "../components/Toaster";
import { api, ApiError, ENROLMENT_REQUIRED_EVENT } from "../lib/api";
import { e2ee } from "../lib/e2ee";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { User } from "../lib/types";

const user: User = {
  id: "0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d",
  username: "maple",
  displayName: "Maple",
  role: "Admin",
  encryptionMode: "EndToEnd",
  hasEndToEndKey: true,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
  secondFactorEnrolmentRequired: true,
};

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function mockSetUp() {
  vi.spyOn(e2ee, "restore").mockResolvedValue(null);
  vi.spyOn(api.twoFactor, "status").mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
  vi.spyOn(api.passkeys, "list").mockResolvedValue([]);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("second-factor set-up screen", () => {
  it("is shown instead of the unlock screen and the app while the server requires a second factor", async () => {
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user });
    mockSetUp();

    render(withQueries(<App />));

    expect(await screen.findByRole("heading", { name: "Add a second sign-in step" })).toBeInTheDocument();
    expect(screen.getByText(/requires administrators to sign in with two-factor sign-in or a passkey/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unlock your notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on two-factor sign-in…" })).toBeInTheDocument();
    // Required here, so the section no longer calls it optional.
    expect(screen.queryByText(/^Optional\. Signing in then needs a code/)).not.toBeInTheDocument();
  });

  it("signs out from the set-up screen", async () => {
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user: { ...user, hasEndToEndKey: false, encryptionMode: "AtRest" } });
    mockSetUp();
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);

    render(withQueries(<App />));
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalled();
  });

  it("fetches the account again when a request is refused for want of a second factor", async () => {
    const status = vi
      .spyOn(api, "status")
      .mockResolvedValue({ setupRequired: false, registrationOpen: false, user: { ...user, hasEndToEndKey: false, encryptionMode: "AtRest" } });
    mockSetUp();
    render(withQueries(<App />));
    expect(await screen.findByRole("heading", { name: "Add a second sign-in step" })).toBeInTheDocument();

    // What the API client fires on a refused request; the account fetched again decides what is shown.
    status.mockResolvedValue({ setupRequired: false, registrationOpen: false, user: null });
    window.dispatchEvent(new Event(ENROLMENT_REQUIRED_EVENT));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a second sign-in step" })).not.toBeInTheDocument());
    expect(status).toHaveBeenCalledTimes(2);
  });
});

describe("refused requests", () => {
  it("announce that the account must set up a second factor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 403, title: "Set up two-factor sign-in or a passkey to continue.", code: "second_factor_enrolment_required" }), {
        status: 403,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const heard = vi.fn();
    window.addEventListener(ENROLMENT_REQUIRED_EVENT, heard);

    await expect(api.listNotes({ state: "feed" })).rejects.toBeInstanceOf(ApiError);

    window.removeEventListener(ENROLMENT_REQUIRED_EVENT, heard);
    vi.unstubAllGlobals();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("do not announce it for other refusals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 403, title: "Forbidden" }), { status: 403 })));
    const heard = vi.fn();
    window.addEventListener(ENROLMENT_REQUIRED_EVENT, heard);

    await expect(api.listNotes({ state: "feed" })).rejects.toBeInstanceOf(ApiError);

    window.removeEventListener(ENROLMENT_REQUIRED_EVENT, heard);
    vi.unstubAllGlobals();
    expect(heard).not.toHaveBeenCalled();
  });
});
