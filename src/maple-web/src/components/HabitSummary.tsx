import { CalendarCheck, Flame, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import {
  habitStart,
  habitStats,
  parseHabit,
  share,
  type HabitStats,
} from "../lib/habits";
import type { Note } from "../lib/types";
import { dayCount, habitName } from "./HabitRow";
import { cn } from "./ui";

/** Every active habit with its numbers, in list order. */
export function statsOf(
  notes: Note[],
  today: string,
  weekStart: number,
): HabitStats[] {
  return notes.map((note) => {
    const habit = parseHabit(note.content);
    return habitStats(
      {
        id: note.id,
        name: habitName(habit),
        start: habitStart(habit, note.createdAtUtc),
        days: habit.days,
      },
      today,
      weekStart,
    );
  });
}

export const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/** A ring filled to `value` (0 to 1), with its label in the middle. */
export function ProgressRing({
  value,
  size = 88,
  children,
}: {
  value: number;
  size?: number;
  children?: ReactNode;
}) {
  const stroke = size / 9;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-stone-200 dark:stroke-stone-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, Math.max(0, value)))}
          className="stroke-maple-600 transition-[stroke-dashoffset] duration-500 dark:stroke-maple-400"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {label}
        </div>
        <div className="font-semibold tabular-nums">{value}</div>
        {hint && (
          <div className="break-words text-xs text-stone-500 dark:text-stone-400">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/** The encouraging line under today's ring. */
function todayMessage(done: number, count: number): string {
  if (done === count) return "All done for today. Nice work!";
  if (done === 0) return "Nothing ticked yet today. Start with one.";
  const left = count - done;
  return `${left} ${left === 1 ? "habit" : "habits"} left for today.`;
}

/** The top of the Habits page: how today is going, the best streak running, and this week so far. */
export function HabitSummary({ stats }: { stats: HabitStats[] }) {
  const done = stats.filter((habit) => habit.doneToday).length;
  const leader = stats.reduce<HabitStats | null>(
    (top, habit) => (!top || habit.current > top.current ? habit : top),
    null,
  );
  const week = share(stats.map((habit) => habit.week));

  return (
    <section
      aria-label="Today"
      className="mb-4 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-gradient-to-br from-maple-50 to-white p-4 shadow-sm dark:border-stone-800 dark:from-maple-600/10 dark:to-stone-900"
    >
      <div className="flex items-center gap-4">
        <ProgressRing value={stats.length ? done / stats.length : 0}>
          <span className="text-lg font-bold leading-none tabular-nums">
            {done}/{stats.length}
          </span>
          <span className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
            today
          </span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="font-semibold">
            {done} of {stats.length} done today
          </p>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {todayMessage(done, stats.length)}
          </p>
        </div>
      </div>
      <div className={cn("grid grid-cols-2 gap-3 border-t border-stone-200 pt-4 sm:grid-cols-3 dark:border-stone-800")}>
        <Stat
          icon={Flame}
          label="Best streak running"
          value={leader && leader.current > 0 ? dayCount(leader.current) : "—"}
          hint={
            leader && leader.current > 0
              ? leader.name
              : "Tick a day to start one"
          }
        />
        <Stat
          icon={CalendarCheck}
          label="This week"
          value={percent(week)}
          hint="of possible days"
        />
        <Stat
          icon={Trophy}
          label="Longest ever"
          value={dayCount(Math.max(0, ...stats.map((habit) => habit.best)))}
        />
      </div>
    </section>
  );
}
