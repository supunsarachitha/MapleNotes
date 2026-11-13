import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { NEW_SIGN_IN_TAG, notificationFor } from "../sw/notify";
import { SignInNotices } from "./SignInNotices";
import { ToastProvider } from "./Toaster";

afterEach(() => vi.restoreAllMocks());

const notice = { id: "n-1", device: "Safari on iOS", atUtc: "2026-11-12T21:15:00Z" };

function renderNotices() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SignInNotices />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("new-device sign-in notices", () => {
  it("shows a banner per notice and dismisses it with It was me", async () => {
    const list = vi.spyOn(api, "signInNotices").mockResolvedValueOnce([notice]).mockResolvedValue([]);
    const dismiss = vi.spyOn(api, "dismissSignInNotice").mockResolvedValue(undefined);
    renderNotices();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/^New sign-in on Safari on iOS, .+\. Not you\? Sign out everywhere\./);
    await userEvent.click(within(banner).getByRole("button", { name: "It was me" }));

    expect(dismiss).toHaveBeenCalledWith("n-1");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("signs out everywhere after a confirmation", async () => {
    vi.spyOn(api, "signInNotices").mockResolvedValue([notice]);
    const signOut = vi.spyOn(api, "signOutEverywhere").mockResolvedValue(undefined);
    renderNotices();

    await userEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Sign out everywhere" }));
    expect(signOut).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out everywhere" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when there are no notices or they cannot be loaded", async () => {
    const list = vi.spyOn(api, "signInNotices").mockRejectedValue(new Error("offline"));
    renderNotices();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the device list from the push notification", () => {
    const { title, options } = notificationFor({ title: "New sign-in", body: "Safari on iOS signed in.", tag: NEW_SIGN_IN_TAG, noteId: null });
    expect(title).toBe("New sign-in");
    expect(options.data).toEqual({ url: "/settings/security" });
    expect(notificationFor({ title: "Reminder", body: "x" }).options.data).toEqual({ url: "/reminders" });
  });
});
