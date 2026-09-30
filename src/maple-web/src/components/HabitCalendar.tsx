import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { firstDayOfWeek } from "../lib/dates";
import { dateOf, daysOf, habitStart, monthOf, parseHabit, scorePeriod, weekday } from "../lib/habits";
import type { Note } from "../lib/types";
import { dayCount, habitName } from "./HabitRow";
import { IconButton, cn } from "./ui";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayTitle = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * A month at a glance under the Habits list: for one habit, the days it was done; for all of them, the days all or some
 * were done. Days before a habit started and after today do not count. It only shows; days are ticked in the list.
 */
export function HabitCalendar({ notes, today, weekStart = firstDayOfWeek() }: { notes: Note[]; today: string; weekStart?: number }) {
  const [selected, setSelected] = useState("all");
  const [monthsBack, setMonthsBack] = useState(0);
  const headingId = useId();
  const habits = notes.map((note) => {
    const habit = parseHabit(note.content);
    return { id: note.id, name: habitName(habit), start: habitStart(habit, note.createdAtUtc), days: habit.days };
  });
  const single = habits.find((habit) => habit.id === selected) ?? null; // one archived or deleted meanwhile: all of them
  const tracked = single ? [single] : habits;
  const month = monthOf(today, -monthsBack);
  const blanks = (weekday(month.start) - weekStart + 7) % 7;
  const total = scorePeriod(tracked, month, today);

  function describe(day: string, done: number, possible: number): string {
    if (possible === 0) return day > today ? "still to come" : single ? "before this habit started" : "no habits yet";
    if (single) return done ? "done" : "not done";
    return `${done} of ${possible} ${possible === 1 ? "habit" : "habits"} done`;
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="mr-auto text-base font-semibold">
          Calendar
        </h2>
        <select
          aria-label="Habits in the calendar"
          value={single ? single.id : "all"}
          onChange={(event) => setSelected(event.target.value)}
          className="h-9 max-w-48 min-w-0 rounded-full border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
        >
          <option value="all">All habits</option>
          {habits.map((habit) => (
            <option key={habit.id} value={habit.id}>
              {habit.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mx-auto mt-3 max-w-sm">
        <div className="mb-1 flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => setMonthsBack(monthsBack + 1)} className="-ml-2">
            <ChevronLeft className="size-5" />
          </IconButton>
          <p className="flex-1 text-center text-sm font-medium" aria-live="polite">
            {monthTitle.format(dateOf(month.start))}
          </p>
          <IconButton label="Next month" disabled={monthsBack === 0} onClick={() => setMonthsBack(monthsBack - 1)} className="-mr-2">
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-stone-400" aria-hidden="true">
          {WEEKDAYS.map((_, i) => (
            <span key={i} className="py-1">
              {WEEKDAYS[(i + weekStart) % 7]}
            </span>
          ))}
        </div>
        <ol className="grid grid-cols-7 gap-1">
          {Array.from({ length: blanks }, (_, i) => (
            <li key={`blank-${i}`} aria-hidden="true" />
          ))}
          {daysOf(month).map((day) => {
            const { done, possible } = scorePeriod(tracked, { start: day, end: day }, today);
            const level = possible === 0 ? "none" : done === 0 ? "missed" : done === possible ? "all" : "some";
            return (
              <li key={day} className="flex justify-center">
                <span
                  className={cn(
                    "flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-sm tabular-nums",
                    level === "all" && "bg-maple-600 font-semibold text-white",
                    level === "some" && "bg-maple-100 font-medium text-maple-700 dark:bg-maple-700/40 dark:text-stone-100",
                    level === "missed" && "text-stone-700 dark:text-stone-300",
                    level === "none" && "text-stone-300 dark:text-stone-600",
                    day === today && "ring-2 ring-maple-500 ring-offset-1 dark:ring-offset-stone-900",
                  )}
                >
                  <span aria-hidden="true">{Number(day.slice(8))}</span>
                  <span className="sr-only">
                    {dayTitle.format(dateOf(day))}
                    {day === today ? " (today)" : ""}: {describe(day, done, possible)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {!single && (
          <p className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-maple-600" /> All done
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-maple-100 dark:bg-maple-700/40" /> Some done
            </span>
          </p>
        )}
        <p className="mt-3 text-center text-sm text-stone-600 dark:text-stone-400">
          {total.possible === 0
            ? "Nothing to count in this month yet."
            : single
              ? `${total.done} of ${dayCount(total.possible)} done`
              : `${Math.round((total.done / total.possible) * 100)}% of habit days done`}
        </p>
      </div>
    </section>
  );
}
