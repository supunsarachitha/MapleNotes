import { useId, useState } from "react";
import { firstDayOfWeek } from "../lib/dates";
import {
  dateOf,
  habitStart,
  parseHabit,
  recentPeriods,
  scorePeriod,
  share,
  streaks,
  type ChartRange,
  type PeriodScore,
} from "../lib/habits";
import type { Note } from "../lib/types";
import { dayCount, habitName } from "./HabitRow";
import { cn } from "./ui";

const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const rateOf = (score: PeriodScore) => (score.possible > 0 ? score.done / score.possible : null);

/** The bars, drawn with plain elements so the labels stay readable at any width. Screen readers get the table instead. */
function Bars({ scores, range }: { scores: PeriodScore[]; range: ChartRange }) {
  const label = (score: PeriodScore) => (range === "weeks" ? shortDay : shortMonth).format(dateOf(score.start));

  return (
    <div aria-hidden="true" className="mt-5">
      <div className="flex">
        <div className="relative h-36 w-10 shrink-0 text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
          {["100%", "50%", "0%"].map((mark, i) => (
            <span key={mark} className="absolute right-2 -translate-y-1/2" style={{ top: `${i * 50}%` }}>
              {mark}
            </span>
          ))}
        </div>
        <div className="relative h-36 flex-1 border-b border-stone-300 dark:border-stone-600">
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-stone-200 dark:border-stone-700" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-stone-200 dark:border-stone-700" />
          <div className="absolute inset-0 flex items-end gap-1 px-1 sm:gap-2">
            {scores.map((score, i) => {
              const rate = rateOf(score);
              const current = i === scores.length - 1;
              return (
                <div key={score.start} className="flex h-full min-w-0 flex-1 items-end justify-center">
                  {rate !== null && (
                    <div
                      data-bar
                      title={`${label(score)}: ${percent(rate)} (${score.done} of ${dayCount(score.possible)})`}
                      className={cn(
                        "w-full max-w-9 rounded-t",
                        rate === 0
                          ? "h-0.5 bg-stone-300 dark:bg-stone-600"
                          : current
                            ? "bg-maple-600 dark:bg-maple-400"
                            : "bg-maple-400 dark:bg-maple-700",
                      )}
                      style={rate === 0 ? undefined : { height: `${rate * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-10 mt-1 flex gap-1 px-1 sm:gap-2">
        {scores.map((score, i) => (
          <span
            key={score.start}
            className={cn(
              "flex min-w-0 flex-1 justify-center text-[11px] text-stone-500 dark:text-stone-400",
              // Every other week on phones, always including this one; a label may run into its hidden neighbours.
              range === "weeks" && (scores.length - 1 - i) % 2 === 1 && "invisible sm:visible",
            )}
          >
            <span className="whitespace-nowrap">{label(score)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Progress under the Habits list: the share of days done per week (last 12) or month (last 12), for all habits or one,
 * with streaks for one habit. A habit counts from its start (see habitStart), and no day after today counts.
 */
export function HabitChart({ notes, today, weekStart = firstDayOfWeek() }: { notes: Note[]; today: string; weekStart?: number }) {
  const [range, setRange] = useState<ChartRange>("weeks");
  const [selected, setSelected] = useState("all");
  const headingId = useId();
  const habits = notes.map((note) => {
    const habit = parseHabit(note.content);
    return { id: note.id, name: habitName(habit), start: habitStart(habit, note.createdAtUtc), days: habit.days };
  });
  const single = habits.find((habit) => habit.id === selected) ?? null; // one archived or deleted meanwhile: all of them
  const scores = recentPeriods(range, today, weekStart).map((period) => scorePeriod(single ? [single] : habits, period, today));
  const unit = range === "weeks" ? "week" : "month";
  const stats = single ? streaks(single.days, today) : null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="mr-auto text-base font-semibold">
          Progress
        </h2>
        <select
          aria-label="Habits in the chart"
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
        <div role="group" aria-label="Period" className="flex rounded-full border border-stone-300 p-0.5 dark:border-stone-700">
          {(["weeks", "months"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn(
                "h-8 rounded-full px-3 text-sm transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500",
                range === value
                  ? "bg-maple-600 font-medium text-white"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
              )}
            >
              {value === "weeks" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
        This {unit}: <strong className="text-stone-900 dark:text-stone-100">{percent(share(scores.slice(-1)))}</strong>
        {" · "}
        Last 12 {unit}s: <strong className="text-stone-900 dark:text-stone-100">{percent(share(scores))}</strong>
      </p>
      {stats && (
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Current streak: <strong className="text-stone-900 dark:text-stone-100">{dayCount(stats.current)}</strong>
          {" · "}
          Best: <strong className="text-stone-900 dark:text-stone-100">{dayCount(stats.best)}</strong>
          {" · "}
          Done: <strong className="text-stone-900 dark:text-stone-100">{dayCount(stats.total)}</strong>
        </p>
      )}

      <Bars scores={scores} range={range} />

      <table className="sr-only">
        <caption>
          Share of days done per {unit}, {single ? single.name : "all habits"}
        </caption>
        <thead>
          <tr>
            <th scope="col">{range === "weeks" ? "Week" : "Month"}</th>
            <th scope="col">Share</th>
            <th scope="col">Days done</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((score) => (
            <tr key={score.start}>
              <th scope="row">
                {range === "weeks" ? `Week of ${shortDay.format(dateOf(score.start))}` : longMonth.format(dateOf(score.start))}
              </th>
              <td>{percent(rateOf(score))}</td>
              <td>{score.possible > 0 ? `${score.done} of ${dayCount(score.possible)}` : "No habits yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
