import { Hash, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Composer } from "../components/Composer";
import { NoteList } from "../components/NoteList";
import { Link, useLocation } from "../lib/router";

function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-300 px-6 py-12 text-center dark:border-stone-700">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-stone-600 dark:text-stone-300">{children}</p>}
    </div>
  );
}

function FilterHeader({ icon: Icon, label }: { icon: typeof Hash; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <Icon className="size-5 text-maple-600 dark:text-maple-400" aria-hidden="true" />
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{label}</h1>
      <Link
        href="/"
        className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
      >
        <X className="size-4" aria-hidden="true" /> Clear
      </Link>
    </div>
  );
}

/** Home: the composer, pinned notes and the feed; or, with ?tag= or ?q=, the matching notes. */
export function HomePage() {
  const { params } = useLocation();
  const tag = params.get("tag") ?? undefined;
  const q = params.get("q") ?? undefined;

  if (tag || q) {
    return (
      <>
        <FilterHeader icon={tag ? Hash : Search} label={tag ? tag : `“${q}”`} />
        <NoteList
          key={`${tag}|${q}`}
          state="active"
          tag={tag}
          q={q}
          empty={<EmptyState title="No matching notes">Archived notes are not included in searches.</EmptyState>}
        />
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">Home</h1>
      <Composer />
      <div className="mt-6 flex flex-col gap-6">
        <NoteList
          state="pinned"
          showEndMarker={false}
          header={<h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Pinned</h2>}
        />
        <NoteList
          state="feed"
          empty={
            <EmptyState title="Nothing here yet">
              Write your first note above. Add #tags to organise notes, and attach photos or files.
            </EmptyState>
          }
        />
      </div>
    </>
  );
}

/** Archived notes, with restore and delete available from each note's menu. */
export function ArchivePage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Archive</h1>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Archived notes are hidden from your feed and searches. Restore them any time.
      </p>
      <NoteList state="archived" empty={<EmptyState title="The archive is empty" />} />
    </>
  );
}
