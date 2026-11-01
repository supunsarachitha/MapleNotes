import { Award, CalendarRange, Flame, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
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
import { ProgressRing } from "./HabitSummary";
import { cn } from "./ui";

const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const rateOf = (score: PeriodScore) => (score.possible > 0 ? score.done / score.possible : null);

/**
 * The bars, drawn with plain elements so the labels stay readable at any width. Each bar can be tapped or focused to
 * show its numbers; screen readers get the table instead.
 */
function Bars({ scores, range }: { scores: PeriodScore[]; range: ChartRange }) {
  const label = (score: PeriodScore) => (range === "weeks" ? shortDay : shortMonth).format(dateOf(score.start));
  const [picked, setPicked] = useState<number | null>(null);
  const shown = scores[picked ?? scores.length - 1]!;
  const shownRate = rateOf(shown);

  return (
    <div className="mt-5">
      <p className="text-sm text-stone-600 dark:text-stone-400" aria-live="polite" data-testid="bar-detail">
        <span className="font-medium text-stone-900 dark:text-stone-100">
          {range === "weeks" ? `Week of ${shortDay.format(dateOf(shown.start))}` : longMonth.format(dateOf(shown.start))}
        </span>
        {": "}
        {shownRate === null ? "no habits yet" : `${percent(shownRate)} · ${shown.done} of ${dayCount(shown.possible)} done`}
      </p>
      <div className="mt-2 flex" aria-hidden="true">
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
              const active = i === (picked ?? scores.length - 1);
              return (
                <button
                  key={score.start}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setPicked(i)}
                  onMouseEnter={() => setPicked(i)}
                  className="group flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center rounded-t hover:bg-stone-50 dark:hover:bg-stone-800/50"
                >
                  {rate !== null && (
                    <div
                      data-bar
                      className={cn(
                        "w-full max-w-9 rounded-t transition-colors",
                        rate === 0
                          ? "h-0.5 bg-stone-300 dark:bg-stone-600"
                          : active
                            ? "bg-maple-600 dark:bg-maple-400"
                            : "bg-maple-600/40 group-hover:bg-maple-600/70 dark:bg-maple-400/40",
                      )}
                      style={rate === 0 ? undefined : { height: `${rate * 100}%` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-10 mt-1 flex gap-1 px-1 sm:gap-2" aria-hidden="true">
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

/** One number with its label, and an optional note under it (such as the trend). */
function Tile({ icon: Icon, label, value, children }: { icon: typeof Flame; label: string; value: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
      <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {children && <div className="mt-0.5 text-xs">{children}</div>}
    </div>
  );
}

/** Up, down or level against the period before, in points. */
function Trend({ now, before, unit }: { now: number | null; before: number | null; unit: string }) {
  if (now === null || before === null) return <span className="text-stone-500 dark:text-stone-400">No earlier {unit} yet</span>;
  const diff = Math.round((now - before) * 100);
  const [Icon, tone, text] =
    diff > 0
      ? [TrendingUp, "text-emerald-700 dark:text-emerald-400", `${diff} pts vs last ${unit}`]
      : diff < 0
        ? [TrendingDown, "text-amber-700 dark:text-amber-400", `${-diff} pts vs last ${unit}`]
        : [Minus, "text-stone-500 dark:text-stone-400", `Same as last ${unit}`];
  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{diff > 0 ? "Up " : diff < 0 ? "Down " : ""}</span>
      {text}
    </span>
  );
}

interface Ranked {
  id: string;
  name: string;
  rate: number | null;
  current: number;
  best: number;
  total: number;
}

/** A sentence that says what the numbers mean. */
function insight(ranked: Ranked[], now: number | null, before: number | null, unit: string): string {
  const scored = ranked.filter((habit) => habit.rate !== null);
  if (scored.length === 0) return "Tick off a few days and your progress will show up here.";
  const parts: string[] = [];
  if (now !== null && before !== null) {
    if (now > before) parts.push(`You're doing better than last ${unit}. Keep it up!`);
    else if (now < before) parts.push(`A slower ${unit} than the last one. One tick today gets you back on track.`);
    else parts.push(`Steady: the same as last ${unit}.`);
  }
  if (scored.length > 1) {
    const [top, low] = [scored[0]!, scored[scored.length - 1]!];
    parts.push(`Strongest: ${top.name} (${percent(top.rate)}).`);
    if (low.rate! < top.rate!) parts.push(`Needs attention: ${low.name} (${percent(low.rate)}).`);
  }
  return parts.join(" ");
}

/**
 * Insights under the Habits list: tiles for this period, the last 12, streaks and days done, with the trend against
 * the period before and a sentence that sums it up; a chart of the share of days done per week or month for all
 * habits or one; and every habit ranked by how often it was done. A habit counts from its start (see habitStart), and
 * no day after today counts.
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
  const periods = recentPeriods(range, today, weekStart);
  const scores = periods.map((period) => scorePeriod(single ? [single] : habits, period, today));
  const unit = range === "weeks" ? "week" : "month";
  const now = share(scores.slice(-1));
  const before = share(scores.slice(-2, -1));
  const ranked: Ranked[] = habits
    .map((habit) => ({ id: habit.id, name: habit.name, rate: share(periods.map((p) => scorePeriod([habit], p, today))), ...streaks(habit.days, today) }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  const shownStreaks = single ? streaks(single.days, today) : null;
  const bestRunning = Math.max(0, ...ranked.map((habit) => habit.current));
  const bestEver = Math.max(0, ...ranked.map((habit) => habit.best));

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="mr-auto text-base font-semibold">
          Insights
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

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="tiles">
        <Tile icon={CalendarRange} label={`This ${unit}`} value={percent(now)}>
          <Trend now={now} before={before} unit={unit} />
        </Tile>
        <Tile icon={CalendarRange} label={`Last 12 ${unit}s`} value={percent(share(scores))}>
          <span className="text-stone-500 dark:text-stone-400">of possible days</span>
        </Tile>
        <Tile icon={Flame} label={single ? "Current streak" : "Best streak running"} value={dayCount(shownStreaks ? shownStreaks.current : bestRunning)} />
        <Tile icon={Award} label={single ? "Best streak" : "Longest streak"} value={dayCount(shownStreaks ? shownStreaks.best : bestEver)}>
          {shownStreaks && <span className="text-stone-500 dark:text-stone-400">{dayCount(shownStreaks.total)} done in total</span>}
        </Tile>
      </div>

      {!single && <p className="mt-3 rounded-xl bg-maple-50 px-3 py-2 text-sm text-stone-700 dark:bg-maple-600/10 dark:text-stone-300">{insight(ranked, now, before, unit)}</p>}

      <Bars key={`${range}-${selected}`} scores={scores} range={range} />

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

      {habits.length > 1 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Habits ranked, last 12 {unit}s</h3>
          <ul aria-label="Habits ranked" className="mt-2 space-y-1">
            {ranked.map((habit) => (
              <li key={habit.id}>
                <button
                  type="button"
                  aria-pressed={selected === habit.id}
                  onClick={() => setSelected(selected === habit.id ? "all" : habit.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-maple-500",
                    selected === habit.id ? "bg-maple-50 dark:bg-maple-600/15" : "hover:bg-stone-50 dark:hover:bg-stone-800/60",
                  )}
                >
                  <ProgressRing value={habit.rate ?? 0} size={36}>
                    <span className="text-[9px] font-semibold tabular-nums">{habit.rate === null ? "—" : Math.round(habit.rate * 100)}</span>
                  </ProgressRing>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{habit.name}</span>
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {percent(habit.rate)} done · streak {dayCount(habit.current)} · best {dayCount(habit.best)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
