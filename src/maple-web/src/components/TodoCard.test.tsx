import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
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
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] maple syrup\n- [x] oats", [], expect.anything()));

    await user.type(screen.getByRole("textbox", { name: "Add an item to Groceries" }), "blueberries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] blueberries\n- [x] maple syrup\n- [x] oats", [], expect.anything()));

    await user.click(screen.getByRole("button", { name: "blueberries" }));
    const edit = screen.getByRole("textbox", { name: "Edit item" });
    await user.clear(edit);
    await user.type(edit, "wild blueberries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] wild blueberries\n- [x] maple syrup\n- [x] oats", [], expect.anything()));

    await user.click(screen.getByRole("button", { name: "Remove oats" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] wild blueberries\n- [x] maple syrup", [], expect.anything()));
  });

  it("moves an item with the arrow keys on its handle, saving the new order and keeping focus on it", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    screen.getByRole("button", { name: "Move oats" }).focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] maple syrup\n- [ ] oats", [], expect.anything()));
    expect(await screen.findByText("oats moved to position 2 of 2.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Move oats" })).toHaveFocus());
    await user.keyboard("{ArrowDown}"); // already last: nothing changes
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("moves an item by dragging its handle past the middle of another row", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    renderWith(<TodoCard note={list} />);
    const rows = within(screen.getByRole("list", { name: "Items in Groceries" })).getAllByRole("listitem");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    const handle = screen.getByRole("button", { name: "Move oats" });
    handle.setPointerCapture = () => {};

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 50 }); // above the middle of row 2: no swap yet
    expect(update).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 70 });

    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] maple syrup\n- [ ] oats", [], expect.anything()));
  });

  it("has no move handles on an archived list or one with a single item", () => {
    renderWith(<TodoCard note={{ ...list, isArchived: true }} />);
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });

  it("says why a change could not be saved when the storage is full", async () => {
    vi.spyOn(api, "updateNote").mockRejectedValue(new ApiError(507, { title: "There is not enough room in your storage.", detail: "Delete notes or files to make room, or ask an administrator for more space." }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.type(screen.getByRole("textbox", { name: "Add an item to Groceries" }), "blueberries{Enter}");

    expect(await screen.findByText("There is not enough room in your storage. Delete notes or files to make room, or ask an administrator for more space.")).toBeInTheDocument();
  });

  it("clears completed items and renames the list from its menu", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear completed" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] oats", [], expect.anything()));

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const name = await screen.findByRole("textbox", { name: "List name" });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Weekend groceries{Enter}");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Weekend groceries\n\n- [ ] oats", [], expect.anything()));
  });

  it("edits all the items at once as Markdown", async () => {
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...list, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit as Markdown" }));
    const box = await screen.findByRole("textbox", { name: "Items in Groceries as Markdown" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("- [ ] oats\n- [x] maple syrup");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "- [[x] oats\n- [[ ] maple syrup\nflour\n\n* [[X] eggs"); // [[ types a [
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [x] oats\n- [ ] maple syrup\n- [ ] flour\n- [x] eggs", [], expect.anything()),
    );
    expect(screen.queryByRole("textbox", { name: "Items in Groceries as Markdown" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "flour" })).not.toBeChecked();
    expect(screen.getByLabelText("2 of 4 done")).toBeInTheDocument();
  });

  it("leaves the list as it was when editing as Markdown is cancelled or changes nothing", async () => {
    const update = vi.spyOn(api, "updateNote");
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit as Markdown" }));
    await user.type(await screen.findByRole("textbox", { name: "Items in Groceries as Markdown" }), "\n- [[ ] bread{Escape}");
    expect(screen.getByRole("checkbox", { name: "oats" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit as Markdown" }));
    const box = await screen.findByRole("textbox", { name: "Items in Groceries as Markdown" });
    expect(box).toHaveValue("- [ ] oats\n- [x] maple syrup"); // the cancelled change is gone
    await user.type(box, "\n\n{Control>}{Enter}{/Control}"); // only empty lines added

    expect(screen.queryByRole("textbox", { name: "Items in Groceries as Markdown" })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("moves a ticked item to the bottom, keeps focus on it and announces the move", async () => {
    const shopping: Note = { ...list, content: "# Groceries\n\n- [ ] oats\n- [ ] flour\n- [x] maple syrup" };
    const update = vi.spyOn(api, "updateNote").mockImplementation(async (id, content) => ({ ...shopping, id, content }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={shopping} />);

    await user.click(screen.getByRole("checkbox", { name: "oats" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] flour\n- [x] maple syrup\n- [x] oats", [], expect.anything()));
    expect(screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual(["flour", "maple syrup", "oats"]);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "oats" })).toHaveFocus());
    expect(screen.getByText("oats moved to the bottom.")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "oats" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("t1", "# Groceries\n\n- [ ] flour\n- [ ] oats\n- [x] maple syrup", [], expect.anything()));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "oats" })).toHaveFocus());
    expect(screen.getByText("oats moved above the ticked items.")).toBeInTheDocument();
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
    expect(update.mock.calls[1]![1]).toBe("# Groceries\n\n- [ ] maple syrup\n- [x] oats");
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
  it("puts the caret at the end when renaming, editing an item or editing as Markdown", async () => {
    const user = userEvent.setup();
    renderWith(<TodoCard note={list} />);
    const atEnd = (field: HTMLElement) => {
      const { selectionStart, value } = field as HTMLInputElement;
      return selectionStart === value.length;
    };

    await user.click(screen.getByRole("button", { name: "oats" }));
    const item = screen.getByRole("textbox", { name: "Edit item" });
    expect(item).toHaveFocus();
    expect(atEnd(item)).toBe(true);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const name = await screen.findByRole("textbox", { name: "List name" });
    await waitFor(() => expect(name).toHaveFocus());
    expect(atEnd(name)).toBe(true);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "List actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit as Markdown" }));
    const markdown = await screen.findByRole("textbox", { name: "Items in Groceries as Markdown" });
    await waitFor(() => expect(markdown).toHaveFocus());
    expect(atEnd(markdown)).toBe(true);
  });

  it("moves a list to the trash, and puts labels on it while labels are on", async () => {
    vi.spyOn(api.labels, "list").mockResolvedValue([{ id: "l-home", name: "Home", color: "Green", noteCount: 1 }]);
    const patch = vi.spyOn(api, "patchNote").mockImplementation(async (_id, changes) => ({ ...list, ...changes }));
    const user = userEvent.setup();
    renderWith(<TodoCard note={{ ...list, labelIds: ["l-home"] }} />, { labels: true });

    expect(await screen.findByRole("link", { name: "Home" })).toHaveAttribute("href", "/?label=l-home");
    await user.click(screen.getByRole("button", { name: "List actions" }));
    expect(screen.getByRole("menuitem", { name: "Labels…" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Move to trash" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(list.id, { isTrashed: true }));
    expect(await screen.findByText("List moved to the trash.")).toBeInTheDocument();
  });

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
