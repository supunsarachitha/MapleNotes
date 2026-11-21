// Calendar days written as `yyyy-MM-dd` keys inside a note's text (habit days, budget dates). They are a third kind of
// date, besides the two in `dates.ts` (local-midnight calendar days and instants): a key names a day with no time zone,
// so arithmetic uses day numbers (days since 1970-01-01 in UTC), which no time zone or daylight-saving change can shift,
// and a key is shown by formatting `dateOf(key)` with `timeZone: "UTC"`.

export const MS_PER_DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

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

/** A date as midnight UTC: format it with `timeZone: "UTC"` to show its day. */
export function dateOf(key: string): Date {
  return new Date(dayNumber(key)! * MS_PER_DAY);
}

/** Moves a date by a number of days. */
export function addDays(key: string, days: number): string {
  return dayKey(dayNumber(key)! + days);
}

/** Formats `dateOf(key)` as "Dec 2". */
export const shortDayFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
/** Formats `dateOf(key)` as "December 2026". */
export const monthYearFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
/** Formats `dateOf(key)` as "Wednesday, December 2". */
export const longDayFormat = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
