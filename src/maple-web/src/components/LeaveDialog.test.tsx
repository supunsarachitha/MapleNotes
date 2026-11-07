import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import { navigate, useLocation } from "../lib/router";
import type { AuthStatus, Note } from "../lib/types";
import { Composer } from "./Composer";
import { LeaveDialog } from "./LeaveDialog";
import { ToastProvider } from "./Toaster";

const saved: Note = {
  id: "n1", kind: "Note", content: "Buy maple syrup", isPinned: false, isArchived: false,
  createdAtUtc: "2026-11-07T12:00:00Z", updatedAtUtc: "2026-11-07T12:00:00Z", tags: [], attachments: [],
};

function Where() {
  return <p data-testid="where">{useLocation().path}</p>;
}

function renderPage(props: Parameters<typeof Composer>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false, registrationOpen: false,
    user: { id: "u", username: "maple", displayName: "Maple", role: "User", encryptionMode: "AtRest", hasEndToEndKey: false, createdAtUtc: "2026-09-28T12:00:00Z", preferences: DEFAULT_PREFERENCES },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <LeaveDialog />
        <Where />
        <Composer {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(api, "listTags").mockResolvedValue([]);
  navigate("/", { force: true });
});
afterEach(() => vi.restoreAllMocks());

const where = () => screen.getByTestId("where").textContent;

describe("leaving with unsaved text", () => {
  it("leaves without asking when nothing was written", async () => {
    renderPage();
    act(() => navigate("/todo"));
    expect(where()).toBe("/todo");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before leaving a new note, and keeps the text on Keep editing", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("New note"), "Buy maple syrup");

    act(() => navigate("/todo"));
    const dialog = await screen.findByRole("dialog", { name: "Save your note?" });
    expect(where()).toBe("/");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(where()).toBe("/");
    expect(screen.getByLabelText("New note")).toHaveValue("Buy maple syrup");
  });

  it("saves, then goes where the user was going", async () => {
    const create = vi.spyOn(api, "createNote").mockResolvedValue(saved);
    renderPage();
    await userEvent.type(screen.getByLabelText("New note"), "Buy maple syrup");

    act(() => navigate("/quick"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(where()).toBe("/quick"));
    expect(create).toHaveBeenCalledWith("Buy maple syrup", []);
  });

  it("stays when saving fails", async () => {
    vi.spyOn(api, "createNote").mockRejectedValue(new Error("offline"));
    renderPage();
    await userEvent.type(screen.getByLabelText("New note"), "Buy maple syrup");
    act(() => navigate("/quick"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await screen.findByText("Could not save the note.");
    expect(where()).toBe("/");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("discards an edit and leaves", async () => {
    const onDone = vi.fn();
    const update = vi.spyOn(api, "updateNote");
    renderPage({ note: saved, onDone, allowTitle: false });
    await userEvent.type(screen.getByLabelText("Edit note"), " and pancakes");

    act(() => navigate("/archive"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(where()).toBe("/archive"));
    expect(onDone).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("undoes a Back press while it asks, and goes back on Discard", async () => {
    act(() => navigate("/quick", { force: true }));
    renderPage();
    await userEvent.type(screen.getByLabelText("New note"), "Half a thought");

    act(() => {
      window.history.replaceState(null, "", "/"); // what the browser's Back does: the address is already the previous page
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const dialog = await screen.findByRole("dialog", { name: "Save your note?" });
    expect(window.location.pathname).toBe("/quick");
    expect(where()).toBe("/quick");

    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(back).toHaveBeenCalled();
    await waitFor(() => expect(where()).toBe("/"));
  });

  it("asks the browser to confirm closing the tab with unsaved text", async () => {
    renderPage();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText("New note"), "Something");
    const again = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
  });
});
