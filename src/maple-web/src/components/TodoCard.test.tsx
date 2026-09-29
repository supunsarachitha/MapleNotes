import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { TodoPage } from "../pages/TodoPage";
import { TodoCard } from "./TodoCard";
import { ToastProvider } from "./Toaster";

const list: Note = {
  id: "t1",
  kind: "Todo",
  content: "# Groceries\n\n- [ ] oats\n- [x] maple syrup",
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-09-29T08:00:00Z",
  updatedAtUtc: "2026-09-29T08:00:00Z",
  tags: [],
  attachments: [],
};

function renderWith(children: ReactNode, preferences: Partial<Preferences> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u",
      username: "maple",
      displayName: "Maple",
      role: "User",
      encryptionMode: "AtRest",
      hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z",
      preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("TodoCard", () => {
  it("shows the list with its progress", () => {
    renderWith(<TodoCard note={list} />);

    expect(screen.getByRole("heading", { name: "Groceries" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "oats" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "maple syrup" })).toBeChecked();
  });

  it("ticks, adds, edits and removes items, saving the list as Markdown", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("checkbox", { name: "oats" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] oats\n- [x] maple syrup", []));

    await user.type(screen.getByRole("textbox", { name: "Add an item to Groceries" }), "blueberries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] oats\n- [x] maple syrup\n- [ ] blueberries", []));

    await user.click(screen.getByRole("button", { name: "blueberries" }));
    const edit = screen.getByRole("textbox", { name: "Edit item" });
    await user.clear(edit);
    await user.type(edit, "wild blueberries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] oats\n- [x] maple syrup\n- [ ] wild blueberries", []));

    await user.click(screen.getByRole("button", { name: "Remove oats" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] maple syrup\n- [ ] wild blueberries", []));
  });

  it("clears completed items and renames the list from its menu", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear completed" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] oats", []));

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const name = await screen.findByRole("textbox", { name: "List name" });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Weekend groceries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Weekend groceries\n\n- [ ] oats", []));
  });

  it("sends quick changes one after another, in order", async () => {
    const answers: Array<() => void> = [];
    const update = vi.spyOn(api, "updateNote").mockImplementation(
      (id, content) => new Promise((resolve) => answers.push(() => resolve({ ...list, id, content }))),
    );
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("checkbox", { name: "oats" }));
    await user.click(screen.getByRole("checkbox", { name: "maple syrup" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("checkbox", { name: "maple syrup" })).not.toBeChecked(); // shown at once
    answers[0]!();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![1]).toBe("# Groceries\n\n- [x] oats\n- [ ] maple syrup");
    answers[1]!();
  });
});

describe("TodoCard and refreshes", () => {
  it("never goes back to a list older than its own last save", async () => {
    let time = Date.parse(list.updatedAtUtc);
    vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content, updatedAtUtc: new Date((time += 1000)).toISOString() }));
    const user = userEvent.setup();
    const view = renderWith(<TodoCard note={list} />);
    const add = screen.getByRole("textbox", { name: "Add an item to Groceries" });

    await user.type(add, "blueberries{Enter}");
    await user.type(add, "coffee{Enter}");
    await waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2));
    // A refresh fetched between the two saves arrives after both: it only has the first item.
    const stale = { ...list, content: `${list.content}\n- [ ] blueberries`, updatedAtUtc: new Date(Date.parse(list.updatedAtUtc) + 1000).toISOString() };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <TodoCard note={stale} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("checkbox", { name: "coffee" })).toBeInTheDocument();
    await user.type(add, "tea{Enter}");
    await waitFor(() => expect(vi.mocked(api.updateNote).mock.calls.at(-1)![1]).toContain("- [ ] coffee\n- [ ] tea"));
  });

  it("takes a newer version from another device", async () => {
    const view = renderWith(<TodoCard note={list} />);
    const newer = { ...list, content: "# Groceries\n\n- [ ] bread", updatedAtUtc: "2026-09-29T09:00:00Z" };

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <TodoCard note={newer} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("checkbox", { name: "bread" })).toBeInTheDocument();
  });
});

describe("TodoPage", () => {
  it("creates a list", async () => {
    vi.spyOn(api, "listNotes").mockResolvedValue({ items: [], nextCursor: null });
    const create = vi.spyOn(api, "createNote").mockResolvedValue({ ...list, content: "# Packing" });
    const user = userEvent.setup();
    renderWith(<TodoPage />);

    expect(await screen.findByText("No lists yet")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "New list name" }), "Packing");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("# Packing", [], { kind: "Todo" }));
  });

  it("says when todo lists are turned off", () => {
    renderWith(<TodoPage />, { todoLists: false });

    expect(screen.getByText("Todo lists are turned off")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "New list name" })).not.toBeInTheDocument();
  });
});
