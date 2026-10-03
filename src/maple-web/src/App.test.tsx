import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ToastProvider } from "./components/Toaster";
import { createNotebook, deleteNotebook, isNotebookOpen } from "./lib/deviceNotebook";
import { DEFAULT_PREFERENCES } from "./lib/preferences";
import { forgetPendingChanges, keepNewNote, pendingChanges, setOutboxOwner } from "./lib/outbox";

// The whole app running on a notebook kept on the device, with no server behind it.

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await deleteNotebook();
  setOutboxOwner(null);
  vi.unstubAllGlobals();
});

describe("The app on a notebook on the device", () => {
  it("opens without a server, writes notes, and leaves an account's changes made offline alone", async () => {
    const fetchSpy = vi.fn((_url: RequestInfo | URL) => Promise.reject(new TypeError("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    // An account wrote a note offline on this device; it waits for that account's next sign-in.
    setOutboxOwner({ userId: "account", keepsNotes: true });
    await forgetPendingChanges();
    await keepNewNote("Waiting for the server", [], {});
    setOutboxOwner(null);
    await createNotebook({ displayName: "Field notes", appName: "Maple Notes", preferences: DEFAULT_PREFERENCES });

    renderApp();
    const menu = await screen.findByRole("complementary");
    expect(within(menu).getByText("On this device")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/What's on your mind/), "Hello from the device");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByText("Hello from the device")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("button", { name: "Close notebook" }));
    // Back to the server, which cannot be reached here: the notebook can be opened again from that screen.
    expect(await screen.findByRole("button", { name: "Open the notebook on this device" })).toBeInTheDocument();
    expect(await isNotebookOpen()).toBe(false);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url) !== "/api/v1/auth/status")).toEqual([]);

    setOutboxOwner({ userId: "account", keepsNotes: true });
    expect((await pendingChanges()).map((change) => change.content)).toEqual(["Waiting for the server"]);
  });
});
