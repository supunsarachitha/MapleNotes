import { toZone } from "../export/zone";
import type { DateFormat, WeekStart } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Formats a local date with one of the formats offered in Settings (.NET-style patterns: `yyyy`, `MMMM`, `MMM`,
 * `MM`, `dddd`, `dd`, `d`). Names are English, like the rest of the app.
 */
export function formatDate(date: Date, format: DateFormat): string {
  const month = MONTHS[date.getMonth()]!;
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()).padStart(4, "0"),
    MMMM: month,
    MMM: month.slice(0, 3),
    MM: pad(date.getMonth() + 1),
    dddd: DAYS[date.getDay()]!,
    dd: pad(date.getDate()),
    d: String(date.getDate()),
  };
  return format.replace(/yyyy|MMMM|MMM|MM|dddd|dd|d/g, (token) => tokens[token]!);
}

// Days and times follow the time zone chosen in Settings (`timeZone`), or this device's when it is Automatic. Dates
// that stand for a calendar day (today, a calendar cell, a daily note) are kept as local-midnight Dates whose
// year, month and day are that day, so day arithmetic stays simple; `calendarDay` and `startOfDay` convert between
// such days and real instants in the chosen zone.
let chosenZone = "";

/** This device's IANA time zone. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Whether this browser knows the IANA time zone. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Uses this time zone for days and times from now on; "" (or one this browser does not know) is this device's. */
export function setTimeZone(zone: string): void {
  chosenZone = zone && isTimeZone(zone) ? zone : "";
}

/** The time zone days and times are shown in. */
export function currentTimeZone(): string {
  return chosenZone || deviceTimeZone();
}

/** The chosen time zone for Intl formatters, or undefined for this device's. */
export function chosenTimeZone(): string | undefined {
  return chosenZone || undefined;
}

/** The calendar day an instant falls on in the chosen time zone (as a local-midnight Date). */
export function calendarDay(instant: Date = new Date()): Date {
  if (!chosenZone) return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  const time = toZone(instant, chosenZone);
  return new Date(time.year, time.month - 1, time.day);
}

/** The `yyyy-MM-dd` of the day an instant falls on in the chosen time zone. */
export const dateKeyOf = (instant: Date): string => localDateKey(calendarDay(instant));

/** The instant a calendar day (a local-midnight Date) starts in the chosen time zone. */
export function startOfDay(day: Date): Date {
  if (!chosenZone) return new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const wall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  // The offset at the guess, then again at the result, settles days that start next to a daylight-saving change.
  let instant = wall - toZone(new Date(wall), chosenZone).offsetMinutes * 60_000;
  instant = wall - toZone(new Date(instant), chosenZone).offsetMinutes * 60_000;
  return new Date(instant);
}

/** Parses `yyyy-MM-dd` as a calendar day (a local-midnight Date), or null. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === key ? date : null;
}

/** The instants a day starts and ends in the chosen time zone, for asking the server for that day's notes. */
export function dayRange(key: string): { createdFrom?: string; createdBefore?: string } {
  const day = parseDateKey(key);
  if (!day) return {};
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { createdFrom: startOfDay(day).toISOString(), createdBefore: startOfDay(next).toISOString() };
}

/** A calendar day (a local-midnight Date) as `yyyy-MM-dd`, which also names a daily note. */
export function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The first day of the week in the user's locale (0 = Sunday), where the browser knows it. */
export function firstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return firstDay ? firstDay % 7 : 0;
  } catch {
    return 0;
  }
}

const WEEKDAY_NUMBERS: Record<Exclude<WeekStart, "Auto">, number> = { Sunday: 0, Monday: 1, Saturday: 6 };

/** The first day of the week the user chose (0 = Sunday), or for Auto the browser's language default. */
export function weekStartDay(choice: WeekStart): number {
  return choice === "Auto" ? firstDayOfWeek() : WEEKDAY_NUMBERS[choice];
}
