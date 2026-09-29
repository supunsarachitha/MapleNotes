import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useNotes } from "../lib/queries";
import type { Note, NoteKind, NoteState } from "../lib/types";
import { NoteCard } from "./NoteCard";
import { Button, Spinner } from "./ui";

/**
 * An infinitely scrolling list of notes: the next page loads when the end of the list scrolls into view
 * (IntersectionObserver), using the server's cursor pagination.
 */
export function NoteList({
  state,
  tag,
  q,
  kinds,
  renderNote = (note) => <NoteCard note={note} />,
  empty,
  header,
  showEndMarker = true,
}: {
  state: NoteState;
  tag?: string;
  q?: string;
  /** Which kinds of notes; default: the timeline. */
  kinds?: NoteKind[];
  /** How each note is shown; default: a note card. */
  renderNote?: (note: Note) => ReactNode;
  empty?: ReactNode;
  header?: ReactNode;
  /** Show "You're all caught up" after a long list has been fully loaded. */
  showEndMarker?: boolean;
}) {
  const query = useNotes(state, tag, q, kinds);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading notes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-stone-600 dark:text-stone-300">Your notes could not be loaded.</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const notes = query.data.pages.flatMap((page) => page.items);
  if (notes.length === 0 && !hasNextPage) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <section className="flex flex-col gap-3">
      {header}
      {notes.map((note) => (
        <Fragment key={note.id}>{renderNote(note)}</Fragment>
      ))}
      {(hasNextPage || isFetchingNextPage) && (
        <div ref={sentinel} className="flex min-h-12 items-center justify-center py-4">
          {isFetchingNextPage ? (
            <Spinner className="size-5 text-stone-400" />
          ) : (
            <Button variant="ghost" onClick={() => void fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      )}
      {!hasNextPage && showEndMarker && notes.length > 5 && (
        <p className="py-4 text-center text-sm text-stone-500 dark:text-stone-400">You're all caught up 🍁</p>
      )}
    </section>
  );
}
