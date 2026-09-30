// Times in the export's time zone (an IANA name), as TimeZoneInfo.ConvertTime and DateTimeOffset formatting show them.

export interface ZonedTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Offset from UTC in minutes. */
  offsetMinutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Parses an API timestamp; JavaScript dates keep milliseconds, the rest of the 7 fractional digits is dropped. */
export function parseUtc(iso: string): Date {
  return new Date(iso.replace(/(\.\d{3})\d+/, "$1"));
}

/** A sortable key for an API timestamp at full (100 ns) precision. */
export function utcSortKey(iso: string): string {
  const match = /^(.*?:\d{2})(?:\.(\d+))?Z$/.exec(iso);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(7, "0")}` : iso;
}

/** The instant in the given time zone, to the second (fractions are truncated, as .NET's format strings do). */
export function toZone(instant: Date, timeZone: string): ZonedTime {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  const local = {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return { ...local, offsetMinutes: Math.round((asUtc - wholeSeconds) / 60_000) };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** yyyy-MM-dd'T'HH:mm:sszzz, e.g. 2026-09-28T14:30:00+02:00. */
export function timestamp(time: ZonedTime): string {
  const offset = Math.abs(time.offsetMinutes);
  const sign = time.offsetMinutes < 0 ? "-" : "+";
  return `${dateOnly(time)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
}

/** yyyy-MM-dd */
export function dateOnly(time: ZonedTime): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
}

/** yyyy-MM-dd_HHmm, the start of a note's file name. */
export function fileStamp(time: ZonedTime): string {
  return `${dateOnly(time)}_${pad(time.hour)}${pad(time.minute)}`;
}

/** A Date whose local fields in this browser equal the zoned time (ZIP entry times carry no zone). */
export function asLocalDate(time: ZonedTime): Date {
  return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}
