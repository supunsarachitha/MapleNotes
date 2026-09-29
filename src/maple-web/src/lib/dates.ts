import type { DateFormat } from "./types";

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

/** A local date as `yyyy-MM-dd`: the calendar day on this device, which names a daily note. */
export function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
