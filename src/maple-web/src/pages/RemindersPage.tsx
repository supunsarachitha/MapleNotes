import { useQueries, useQuery } from "@tanstack/react-query";
import { NoteCard } from "../components/NoteCard";
import { EmptyState, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { calendarDay, localDateKey } from "../lib/dates";
import { pushSupport } from "../lib/push";
import { useReminders } from "../lib/reminders";
import { Link, useLocation } from "../lib/router";
import type { Reminder } from "../lib/types";

/** "Today", "Tomorrow", or the date, for grouping reminders by the day they next go off (in the chosen time zone). */
function dayHeading(iso: string, now = new Date()): string {
  const day = localDateKey(calendarDay(new Date(iso)));
  const today = calendarDay(now);
  if (day === localDateKey(today)) return "Today";
  if (day === localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))) return "Tomorrow";
  return calendarDay(new Date(iso)).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * Upcoming reminders, soonest first, grouped by day, each as its note (whose bell shows the time and repeat). A notification opens this page at
 * `?note=<id>`, which shows that note first (its reminder may already be done).
 */
export function RemindersPage() {
  const { params } = useLocation();
  const opened = params.get("note");
  const reminders = useReminders();
  const list = reminders.data ?? [];
  const notes = useQueries({
    queries: list.map((reminder) => ({ queryKey: ["notes", "one", reminder.noteId], queryFn: () => api.note(reminder.noteId) })),
  });
  const openedNote = useQuery({
    queryKey: ["notes", "one", opened ?? ""],
    queryFn: () => api.note(opened!),
    enabled: Boolean(opened) && !list.some((r) => r.noteId === opened),
  });

  const groups: Array<{ heading: string; items: Array<{ reminder: Reminder; index: number }> }> = [];
  list.forEach((reminder, index) => {
    const heading = dayHeading(reminder.nextAtUtc);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.items.push({ reminder, index });
    else groups.push({ heading, items: [{ reminder, index }] });
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Reminders</h1>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Notes you asked to be reminded of, soonest first. Set one with <strong>Remind me…</strong> in a note's menu.{" "}
        {pushSupport() === "supported" && (
          <Link href="/settings/notifications" className="underline">
            Notifications on this device
          </Link>
        )}
      </p>

      {opened && openedNote.data && (
        <section className="mb-6" aria-label="The note you were reminded of">
          <h2 className="mb-2 text-sm font-semibold text-maple-700 dark:text-maple-400">You were reminded of</h2>
          <NoteCard note={openedNote.data} />
        </section>
      )}

      {reminders.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No reminders">Open a note's menu and choose Remind me… to be notified about it later.</EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.heading} className="mb-6" aria-label={group.heading}>
            <h2 className="mb-2 text-sm font-semibold text-stone-600 dark:text-stone-300">{group.heading}</h2>
            <ul className="flex flex-col gap-3">
              {group.items.map(({ reminder, index }) => {
                const note = notes[index]?.data;
                return (
                  <li key={reminder.noteId} className={reminder.noteId === opened ? "rounded-2xl ring-2 ring-maple-500" : undefined}>
                    {note ? <NoteCard note={note} /> : <div className="h-20 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
