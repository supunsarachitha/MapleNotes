import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Tag } from "../lib/types";
import { tagTree, TagsPage } from "./TagsPage";

const tags: Tag[] = [
  { name: "ideas", noteCount: 2 },
  { name: "work", noteCount: 1 },
  { name: "work/meetings", noteCount: 5 },
  { name: "travel/japan", noteCount: 3 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: { id: "u", username: "m", displayName: "M", role: "User", encryptionMode: "AtRest", hasEndToEndKey: false, createdAtUtc: "", preferences: DEFAULT_PREFERENCES },
  });
  render(
    <QueryClientProvider client={client}>
      <TagsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("tags", () => {
  it("nests tags under their parents, with totals for ordering", () => {
    const tree = tagTree(tags, "count");

    expect(tree.map((n) => [n.path, n.count, n.total])).toEqual([["work", 1, 6], ["travel", null, 3], ["ideas", 2, 2]]);
    expect(tree[0]!.children.map((n) => [n.label, n.count])).toEqual([["meetings", 5]]);
    expect(tagTree(tags, "name").map((n) => n.path)).toEqual(["ideas", "travel", "work"]);
  });

  it("lists every tag with its count, links to its notes, and filters", async () => {
    vi.spyOn(api, "listTags").mockResolvedValue(tags);
    const user = userEvent.setup();
    renderPage();

    const all = await screen.findByRole("list", { name: "All tags" });
    expect(within(all).getByRole("link", { name: "work/meetings, 5 notes" })).toHaveAttribute("href", "/?tag=work%2Fmeetings");
    expect(within(all).getByRole("link", { name: "travel" })).toHaveAttribute("href", "/?tag=travel"); // a parent without notes of its own

    await user.type(screen.getByRole("searchbox", { name: "Filter tags" }), "#MEET");
    const matches = screen.getByRole("list", { name: "Matching tags" });
    expect(within(matches).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual(["work/meetings, 5 notes"]);

    await user.clear(screen.getByRole("searchbox", { name: "Filter tags" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter tags" }), "zzz");
    expect(screen.getByText("No tags match “zzz”.")).toBeInTheDocument();
  });

  it("sorts by use", async () => {
    vi.spyOn(api, "listTags").mockResolvedValue(tags);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("radio", { name: "Most used" }));

    const top = within(screen.getByRole("list", { name: "All tags" })).getAllByRole("link");
    expect(top.map((l) => l.getAttribute("aria-label"))).toEqual(["work, 1 note", "work/meetings, 5 notes", "travel", "travel/japan, 3 notes", "ideas, 2 notes"]);
  });
});
