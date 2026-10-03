import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { closeNotebook, createNotebook, deleteNotebook, isNotebookOpen, notebookOnDevice } from "../lib/deviceNotebook";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus } from "../lib/types";
import { AuthPage } from "../pages/AuthPage";

// The sign-in page's way to a notebook kept on the device: offered in the installed app where administrators allow it,
// and a notebook already on the device always opens.

function installed(yes: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: yes && query === "(display-mode: standalone)" }) as MediaQueryList);
}

function renderSignIn(deviceNotebooks: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: null,
    deviceNotebooks,
    branding: { appName: "Family Notes", iconUrl: null },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthPage mode="login" registrationOpen={false} deviceNotebooks={deviceNotebooks} />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(async () => {
  await deleteNotebook();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A notebook on the device, from the sign-in page", () => {
  it("is offered in the installed app when administrators allow it, and created there", async () => {
    installed(true);
    const client = renderSignIn(true);

    await userEvent.click(await screen.findByRole("button", { name: "Keep notes on this device" }));
    const dialog = screen.getByRole("dialog", { name: "Keep notes on this device" });
    expect(dialog).toHaveTextContent("Nothing is synced or backed up.");
    await userEvent.type(within(dialog).getByLabelText("Name (optional)"), "Field notes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create notebook" }));

    await waitFor(async () => expect(await notebookOnDevice()).toMatchObject({ displayName: "Field notes", open: true }));
    expect(await isNotebookOpen()).toBe(true);
    // The app reads the status again, now from the notebook.
    await waitFor(() => expect(client.getQueryData<AuthStatus>(queryKeys.status)?.onDevice).toBe(true));
    expect(client.getQueryData<AuthStatus>(queryKeys.status)?.branding?.appName).toBe("Family Notes");
    await closeNotebook();
  });

  it("asks for the app to be installed first in a browser tab", async () => {
    installed(false);
    renderSignIn(true);

    expect(await screen.findByText("Install Family Notes as an app to keep notes on this device without an account.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep notes on this device" })).not.toBeInTheDocument();
  });

  it("is not offered when administrators have not allowed it", async () => {
    installed(true);
    renderSignIn(false);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("button", { name: "Keep notes on this device" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Install Family Notes/)).not.toBeInTheDocument();
  });

  it("still opens a notebook the device has, whatever the setting says now", async () => {
    installed(true);
    await createNotebook({ displayName: "Travel", appName: "Maple Notes", preferences: DEFAULT_PREFERENCES });
    await api.createNote("Kept here", []);
    await closeNotebook();
    renderSignIn(false);

    expect(await screen.findByText("Travel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the notebook on this device" }));

    await waitFor(async () => expect(await isNotebookOpen()).toBe(true));
    expect((await api.listNotes({ state: "feed" })).items.map((note) => note.content)).toEqual(["Kept here"]);
    await closeNotebook();
  });
});
