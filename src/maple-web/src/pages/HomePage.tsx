import { CalendarDays, Hash, Search, X } from "lucide-react";
import { Composer } from "../components/Composer";
import { NoteList } from "../components/NoteList";
import { EmptyState } from "../components/ui";
import { NoteCard } from "../components/NoteCard";
import { useTodaysNote } from "../lib/daily";
import { formatDate, parseDateKey } from "../lib/dates";
import { useEnabledKinds } from "../lib/kinds";
import { usePreferences } from "../lib/preferences";
import { Link, useLocation } from "../lib/router";
import { FeatureOff } from "./TodoPage";

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

const sectionHeading = "px-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400";

/** With daily notes on: today's note, or a composer that starts it with the first words written. */
function TodayCard({ today }: { today: ReturnType<typeof useTodaysNote> }) {
  const { date, title, query } = today;
  return (
    <section aria-label="Today" className="flex flex-col gap-3">
      <h2 className={sectionHeading}>Today</h2>
      {query.isPending ? (
        <div className="h-28 animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" aria-busy="true" aria-label="Loading today's note" />
      ) : query.data ? (
        <NoteCard note={query.data} />
      ) : (
        <Composer key={date} daily={{ date, title }} placeholder="Write about your day…" />
      )}
    </section>
  );
}

/** Home: today's note, the composer, pinned notes and the feed; or, with ?tag= or ?q=, the matching notes. */
export function HomePage() {
  const { params } = useLocation();
  const kinds = useEnabledKinds();
  const tag = params.get("tag") ?? undefined;
  const q = params.get("q") ?? undefined;
  const dayKey = params.get("day") ?? undefined;
  const day = dayKey ? parseDateKey(dayKey) : null;
  const { dateFormat } = usePreferences();
  const today = useTodaysNote();
  const hideIds = today.enabled && today.query.data ? [today.query.data.id] : [];

  if (day && dayKey) {
    return (
      <>
        <FilterHeader icon={CalendarDays} label={formatDate(day, dateFormat)} />
        <NoteList
          key={dayKey}
          state="active"
          kinds={kinds}
          day={dayKey}
          empty={<EmptyState title="No notes on this day">Archived notes are not included.</EmptyState>}
        />
      </>
    );
  }

  if (tag || q) {
    return (
      <>
        <FilterHeader icon={tag ? Hash : Search} label={tag ? tag : `“${q}”`} />
        <NoteList
          key={`${tag}|${q}`}
          state="active"
          tag={tag}
          q={q}
          kinds={kinds}
          empty={<EmptyState title="No matching notes">Archived notes are not included in searches.</EmptyState>}
        />
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">Home</h1>
      {today.enabled && (
        <div className="mb-6">
          <TodayCard today={today} />
        </div>
      )}
      <Composer />
      <div className="mt-6 flex flex-col gap-6">
        <NoteList state="pinned" showEndMarker={false} hideIds={hideIds} header={<h2 className={sectionHeading}>Pinned</h2>} />
        <NoteList
          state="feed"
          hideIds={hideIds}
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

/** Archived notes (and todo lists and quick notes), with restore and delete available from each one's menu. */
export function ArchivePage() {
  const kinds = useEnabledKinds();
  if (!usePreferences().archive) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Archive</h1>
        <FeatureOff title="The Archive is turned off">Your archived notes are kept.</FeatureOff>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Archive</h1>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Archived notes are hidden from your feed and searches. Restore them any time.
      </p>
      <NoteList state="archived" kinds={kinds} empty={<EmptyState title="The archive is empty" />} />
    </>
  );
}
