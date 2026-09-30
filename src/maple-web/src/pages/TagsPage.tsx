import { Hash, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, cn } from "../components/ui";
import { useEnabledKinds } from "../lib/kinds";
import { usePreferences } from "../lib/preferences";
import { useTags } from "../lib/queries";
import { Link } from "../lib/router";
import type { Tag } from "../lib/types";
import { FeatureOff } from "./TodoPage";

export type TagOrder = "name" | "count";

export interface TagNode {
  /** The full tag, e.g. work/meetings. */
  path: string;
  /** The last part, e.g. meetings. */
  label: string;
  /** Notes with exactly this tag; null for a parent that only exists through its nested tags. */
  count: number | null;
  /** This tag's notes plus those of every tag below it. */
  total: number;
  children: TagNode[];
}

/** Arranges tags as a tree by their `/` parts, sorted by name or by how many notes use them. */
export function tagTree(tags: Tag[], order: TagOrder): TagNode[] {
  const roots: TagNode[] = [];
  const byPath = new Map<string, TagNode>();
  for (const tag of tags) {
    let siblings = roots;
    let path = "";
    for (const part of tag.name.split("/")) {
      path = path ? `${path}/${part}` : part;
      let node = byPath.get(path);
      if (!node) {
        node = { path, label: part, count: null, total: 0, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      node.total += tag.noteCount;
      if (path === tag.name) node.count = tag.noteCount;
      siblings = node.children;
    }
  }
  const sort = (nodes: TagNode[]) => {
    nodes.sort((a, b) => (order === "count" && b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)));
    nodes.forEach((node) => sort(node.children));
    return nodes;
  };
  return sort(roots);
}

function TagLink({ path, label, count, depth = 0 }: { path: string; label: string; count: number | null; depth?: number }) {
  return (
    <Link
      href={`/?tag=${encodeURIComponent(path)}`}
      aria-label={count === null ? path : `${path}, ${count} ${count === 1 ? "note" : "notes"}`}
      className="flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800"
      style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
    >
      <Hash className="size-4 shrink-0 text-maple-600 dark:text-maple-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {count !== null && (
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {count}
        </span>
      )}
    </Link>
  );
}

function TagBranch({ node, depth }: { node: TagNode; depth: number }) {
  return (
    <li>
      <TagLink path={node.path} label={node.label} count={node.count} depth={depth} />
      {node.children.length > 0 && (
        <ul aria-label={`Tags under ${node.path}`}>
          {node.children.map((child) => (
            <TagBranch key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every tag with how many notes use it: nested tags under their parents, a filter, and two orders. */
export function TagsPage() {
  if (!usePreferences().tags) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Tags</h1>
        <FeatureOff title="The Tags page is turned off">Tags in your notes still work.</FeatureOff>
      </>
    );
  }
  return <Tags />;
}

function Tags() {
  const tags = useTags(useEnabledKinds());
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<TagOrder>("name");
  const all = useMemo(() => tags.data ?? [], [tags.data]);
  const tree = useMemo(() => tagTree(all, order), [all, order]);
  const needle = filter.trim().replace(/^#/, "").toLowerCase();
  const matches = needle
    ? all
        .filter((tag) => tag.name.toLowerCase().includes(needle))
        .sort((a, b) => (order === "count" && b.noteCount !== a.noteCount ? b.noteCount - a.noteCount : a.name.localeCompare(b.name)))
    : null;

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Tags</h1>
      {tags.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" aria-busy="true" aria-label="Loading tags" />
      ) : all.length === 0 ? (
        <EmptyState title="No tags yet">Add #tags to your notes, like #ideas or #work/meetings, and they appear here.</EmptyState>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-wrap items-center gap-2 p-1">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={`Filter ${all.length} tags`}
                aria-label="Filter tags"
                className="h-10 w-full rounded-full border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm outline-none focus:border-maple-500 focus:bg-white dark:border-stone-700 dark:bg-stone-800 dark:focus:bg-stone-900"
              />
            </div>
            <div role="radiogroup" aria-label="Order" className="flex rounded-full bg-stone-100 p-1 text-sm dark:bg-stone-800">
              {(["name", "count"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={order === value}
                  onClick={() => setOrder(value)}
                  className={cn(
                    "rounded-full px-3 py-1",
                    order === value ? "bg-white font-medium shadow-sm dark:bg-stone-900" : "text-stone-600 dark:text-stone-300",
                  )}
                >
                  {value === "name" ? "A–Z" : "Most used"}
                </button>
              ))}
            </div>
          </div>
          {matches ? (
            matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-stone-500">No tags match “{filter.trim()}”.</p>
            ) : (
              <ul aria-label="Matching tags" className="mt-1">
                {matches.map((tag) => (
                  <li key={tag.name}>
                    <TagLink path={tag.name} label={tag.name} count={tag.noteCount} />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul aria-label="All tags" className="mt-1">
              {tree.map((node) => (
                <TagBranch key={node.path} node={node} depth={0} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
