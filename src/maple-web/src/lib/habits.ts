import { localDateKey } from "./dates";
import { joinTitle, splitTitle } from "./titles";

// A habit is a note of kind "Habit". Its text is Markdown: the habit's name as a `# title`, then one `- yyyy-MM-dd`
// line for each day it was done, so habits are encrypted, exported and restored like every other note.
//
// Days are calendar dates on the user's device, like daily notes. Arithmetic on them uses day numbers (days since
// 1970-01-01 in UTC), which no time zone or daylight-saving change can shift.

/** A habit as the Habits page edits it. */
export interface Habit {
  /** Its name: the note's title. */
  name: string;
  /** The days it was done (`yyyy-MM-dd`), oldest first, each once. */
  days: string[];
  /** Any other text in the note, such as a description added to an exported file, kept as it was. */
  notes: string;
}

/** How far back the chart looks. */
export type ChartRange = "weeks" | "months";

/** A stretch of days, first and last included. */
export interface Period {
  start: string;
  end: string;
}

/** The days done in a period, and the days that could have been done. */
export interface PeriodScore extends Period {
  done: number;
  possible: number;
}

/** What the chart needs to know about a habit. */
export interface TrackedHabit {
  /** The first day it counts from (see habitStart). */
  start: string;
  days: string[];
}

const MS_PER_DAY = 86_400_000;
const DAY_LINE = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const pad = (value: number) => String(value).padStart(2, "0");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The day number (days since 1970-01-01) of a valid `yyyy-MM-dd` date, or null. */
export function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / MS_PER_DAY;
}

/** The `yyyy-MM-dd` date of a day number. */
export function dayKey(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Moves a date by a number of days. */
export function addDays(key: string, days: number): string {
  return dayKey(dayNumber(key)! + days);
}

/** The day of the week of a date, 0 for Sunday. */
export function weekday(key: string): number {
  return new Date(dayNumber(key)! * MS_PER_DAY).getUTCDay();
}

/** The `count` days that end on `end`, oldest first. */
export function daysEnding(end: string, count: number): string[] {
  const last = dayNumber(end)!;
  return Array.from({ length: count }, (_, i) => dayKey(last - count + 1 + i));
}

/** Reads a habit from its note's text. Lines that are not days, such as a description, are kept as they are. */
export function parseHabit(content: string): Habit {
  const { title, body } = splitTitle(content);
  const days = new Set<string>();
  const other: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const day = DAY_LINE.exec(line)?.[1];
    if (day && dayNumber(day) !== null) days.add(day);
    else other.push(line);
  }
  return { name: title, days: [...days].sort(), notes: other.join("\n").trim() };
}

/** Writes a habit as Markdown: its `# name`, any other text, then the days done. A habit always has a name. */
export function serializeHabit(habit: Habit): string {
  const days = habit.days.map((day) => `- ${day}`).join("\n");
  return joinTitle(oneLine(habit.name) || "Untitled habit", [habit.notes.trim(), days].filter(Boolean).join("\n\n"));
}

/** Marks a day done, or not done if it was. */
export function toggleDay(habit: Habit, day: string): Habit {
  const days = habit.days.includes(day) ? habit.days.filter((d) => d !== day) : [...habit.days, day].sort();
  return { ...habit, days };
}

/** The first day a habit counts from: the day it was created on this device, or its first day done if earlier. */
export function habitStart(habit: Habit, createdAtUtc: string): string {
  const created = localDateKey(new Date(createdAtUtc));
  const first = habit.days[0];
  return first !== undefined && first < created ? first : created;
}

/**
 * The current streak (days done in a row up to today, or up to yesterday while today is not ticked yet), the best
 * streak, and the days done in total. Days after today do not count.
 */
export function streaks(days: string[], today: string): { current: number; best: number; total: number } {
  const past = [...new Set(days.filter((day) => day <= today))].map((day) => dayNumber(day)!).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  past.forEach((day, i) => {
    run = i > 0 && day === past[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  const done = new Set(past);
  let day = dayNumber(today)!;
  if (!done.has(day)) day -= 1;
  let current = 0;
  while (done.has(day)) {
    current += 1;
    day -= 1;
  }
  return { current, best, total: past.length };
}

/**
 * The last `count` weeks or months, oldest first; the last one holds today. Weeks start on `weekStart` (0 for
 * Sunday), as in the side-menu calendar.
 */
export function recentPeriods(range: ChartRange, today: string, weekStart: number, count = 12): Period[] {
  if (range === "weeks") {
    const start = dayNumber(today)! - ((weekday(today) - weekStart + 7) % 7);
    return Array.from({ length: count }, (_, i) => {
      const first = start - 7 * (count - 1 - i);
      return { start: dayKey(first), end: dayKey(first + 6) };
    });
  }
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  return Array.from({ length: count }, (_, i) => {
    const back = count - 1 - i;
    return {
      start: dayKey(Date.UTC(year, month - back, 1) / MS_PER_DAY),
      end: dayKey(Date.UTC(year, month - back + 1, 0) / MS_PER_DAY),
    };
  });
}

/**
 * How many days of a period the habits were done, out of how many they could have been: each habit counts from its
 * start, and no day after today counts.
 */
export function scorePeriod(habits: TrackedHabit[], period: Period, today: string): PeriodScore {
  const last = period.end < today ? period.end : today;
  let done = 0;
  let possible = 0;
  for (const habit of habits) {
    const first = period.start > habit.start ? period.start : habit.start;
    if (first > last) continue;
    possible += dayNumber(last)! - dayNumber(first)! + 1;
    done += habit.days.filter((day) => day >= first && day <= last).length;
  }
  return { ...period, done, possible };
}

/** The share of possible days done, from 0 to 1, or null when no day was possible. */
export function share(scores: Array<{ done: number; possible: number }>): number | null {
  const possible = scores.reduce((sum, score) => sum + score.possible, 0);
  return possible > 0 ? scores.reduce((sum, score) => sum + score.done, 0) / possible : null;
}
