import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Flame, Repeat, Search, Zap, CalendarRange, Feather } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/dates";
import { useEnabledKinds } from "../lib/kinds";
import { usePreferences } from "../lib/preferences";
import { queryKeys, useAuthStatus } from "../lib/queries";
import { Link } from "../lib/router";

const STATS_DAYS = 60;

/** "Good morning" and so on, from the hour of the day. */
export function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Writing stats from per-day note counts: notes in the last 7 days (today included), notes in the last 30, and the
 * streak of consecutive days with notes ending today — or yesterday, so the streak is not lost before today's note.
 */
export function writingStats(counts: Map<string, number>, today: Date): { week: number; month: number; streak: number } {
  const day = (offset: number) => localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
  let week = 0;
  let month = 0;
  for (let i = 0; i < 30; i++) {
    const count = counts.get(day(i)) ?? 0;
    month += count;
    if (i < 7) week += count;
  }
  let streak = 0;
  let i = (counts.get(day(0)) ?? 0) > 0 ? 0 : 1;
  while (i < STATS_DAYS && (counts.get(day(i)) ?? 0) > 0) {
    streak++;
    i++;
  }
  return { week, month, streak };
}

function Stat({ icon: Icon, value, label, accent }: { icon: typeof Flame; value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3 py-2.5 shadow-sm max-sm:rounded-xl max-sm:px-2.5 max-sm:py-1.5 dark:border-stone-800 dark:bg-stone-900">
      <span
        className={
          accent
            ? "flex size-9 shrink-0 items-center justify-center rounded-xl bg-maple-100 text-maple-700 max-sm:hidden dark:bg-maple-600/20 dark:text-maple-400"
            : "flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 max-sm:hidden dark:bg-stone-800 dark:text-stone-300"
        }
      >
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-lg font-semibold leading-tight tabular-nums max-sm:text-base">
          <Icon
            className={`size-3.5 shrink-0 sm:hidden ${accent ? "text-maple-600 dark:text-maple-400" : "text-stone-500 dark:text-stone-400"}`}
            aria-hidden="true"
          />
          {value}
        </p>
        <p className="whitespace-nowrap text-xs text-stone-500 max-sm:text-[11px] dark:text-stone-400">{label}</p>
      </div>
    </div>
  );
}

const chip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3.5 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-maple-400 hover:text-maple-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-maple-600 dark:hover:text-maple-400";

/** Focuses the side menu's search box; on small screens the navigation drawer opens first. */
export function focusSearch() {
  const visible = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="search"]')).find((box) => box.getClientRects().length > 0);
  const box = visible();
  if (box) return box.focus();
  document.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')?.click();
  setTimeout(() => visible()?.focus(), 60);
}

/** True while the user is typing somewhere, so single-key shortcuts stay out of the way. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Home's single-key shortcuts: N writes a new note, / searches. */
export function useHomeShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        document.getElementById("composer")?.focus();
      } else if (event.key === "/") {
        event.preventDefault();
        focusSearch();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

const kbd =
  "rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";

/** Home's header: a greeting with the date, writing stats and shortcuts to the other tabs. */
export function HomeHeader({ now = new Date() }: { now?: Date }) {
  useHomeShortcuts();
  const user = useAuthStatus().data?.user;
  const preferences = usePreferences();
  const kinds = useEnabledKinds();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (STATS_DAYS - 1));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const days = useQuery({
    queryKey: [...queryKeys.notes, "stats", localDateKey(now), kinds.join(",")],
    queryFn: () => api.calendar(localDateKey(from), localDateKey(now), timeZone, kinds),
    staleTime: 60_000,
  });
  const stats = days.data ? writingStats(new Map(days.data.map((d) => [d.date, d.count])), now) : null;
  const firstName = user?.displayName.trim().split(/\s+/)[0];
  const longDate = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <header className="mb-6 flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-maple-700 dark:text-maple-400">
          {longDate}
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting(now.getHours())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Writing stats" aria-busy={days.isPending || undefined}>
        {stats ? (
          <>
            <Stat icon={Flame} accent value={stats.streak} label="day streak" />
            <Stat icon={Feather} value={stats.week} label="this week" />
            <Stat icon={CalendarRange} value={stats.month} label="30 days" />
          </>
        ) : (
          [0, 1, 2].map((i) => <div key={i} className="h-[50px] animate-pulse sm:h-[62px] rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" />)
        )}
      </div>

      <nav aria-label="Quick actions" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {preferences.todoLists && (
          <Link href="/todo" className={chip}>
            <CheckSquare className="size-4" aria-hidden="true" /> Todo
          </Link>
        )}
        {preferences.quickNotes && (
          <Link href="/quick" className={chip}>
            <Zap className="size-4" aria-hidden="true" /> Quick note
          </Link>
        )}
        {preferences.habitTracker && (
          <Link href="/habits" className={chip}>
            <Repeat className="size-4" aria-hidden="true" /> Habits
          </Link>
        )}
        <button type="button" className={chip} aria-keyshortcuts="/" onClick={focusSearch}>
          <Search className="size-4" aria-hidden="true" /> Search
          <kbd className={`${kbd} ml-1 hidden sm:inline`} aria-hidden="true">/</kbd>
        </button>
      </nav>
    </header>
  );
}
