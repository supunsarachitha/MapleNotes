const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const shortDateWithYear = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** "just now", "5 min. ago", "yesterday", "Sep 12", "Sep 12, 2024" — compact, feed-style. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), "day");
  return date.getFullYear() === now.getFullYear() ? shortDate.format(date) : shortDateWithYear.format(date);
}

/** Full date and time, for tooltips. */
export function formatAbsolute(iso: string): string {
  return absolute.format(new Date(iso));
}

/** Human-readable byte size: "512 B", "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
