import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { useToday } from "../lib/daily";
import { firstDayOfWeek, localDateKey, parseDateKey } from "../lib/dates";
import { useEnabledKinds } from "../lib/kinds";
import { queryKeys } from "../lib/queries";
import { Link, useLocation } from "../lib/router";
import { IconButton, cn } from "./ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * A month calendar for the side menu. Days with active notes (of the kinds that are turned on) get a dot; choosing a day
 * opens its notes on Home (`/?day=yyyy-MM-dd`). Days are this device's calendar days.
 */
export function Calendar({ onNavigate }: { onNavigate?: () => void }) {
  const { params } = useLocation();
  const selected = params.get("day");
  const today = useToday();
  const kinds = useEnabledKinds();
  const [month, setMonth] = useState(() => {
    const base = (selected && parseDateKey(selected)) || today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = month.getFullYear();
  const index = month.getMonth();
  const last = new Date(year, index + 1, 0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const days = useQuery({
    queryKey: queryKeys.calendar(localDateKey(month), kinds),
    queryFn: () => api.calendar(localDateKey(month), localDateKey(last), timeZone, kinds),
    staleTime: 30_000,
  });
  const counts = new Map(days.data?.map((day) => [day.date, day.count]));

  const weekStart = firstDayOfWeek();
  const blanks = (month.getDay() - weekStart + 7) % 7;
  const weekdays = WEEKDAYS.map((_, i) => WEEKDAYS[(i + weekStart) % 7]!);
  const todayKey = localDateKey(today);

  return (
    <section aria-label="Calendar" className="px-1">
      <div className="mb-1 flex items-center gap-1">
        <h2 className="flex-1 px-2 text-sm font-semibold" aria-live="polite">
          {monthTitle.format(month)}
        </h2>
        <IconButton label="Previous month" className="size-8" onClick={() => setMonth(new Date(year, index - 1, 1))}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next month" className="size-8" onClick={() => setMonth(new Date(year, index + 1, 1))}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-stone-400" aria-hidden="true">
        {weekdays.map((name) => (
          <span key={name} className="py-1">
            {name.slice(0, 2)}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: blanks }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: last.getDate() }, (_, i) => {
          const date = new Date(year, index, i + 1);
          const key = localDateKey(date);
          const count = counts.get(key) ?? 0;
          const isSelected = key === selected;
          return (
            <li key={key} className="flex justify-center">
              <Link
                href={`/?day=${key}`}
                onClick={onNavigate}
                aria-current={isSelected ? "page" : undefined}
                aria-label={`${dayTitle.format(date)}${count ? `, ${count} ${count === 1 ? "note" : "notes"}` : ""}${key === todayKey ? " (today)" : ""}`}
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                  isSelected
                    ? "bg-maple-600 font-semibold text-white"
                    : key === todayKey
                      ? "font-semibold text-maple-700 ring-1 ring-maple-500 dark:text-maple-400"
                      : count
                        ? "font-medium text-stone-800 hover:bg-stone-100 dark:text-stone-100 dark:hover:bg-stone-800"
                        : "text-stone-400 hover:bg-stone-100 dark:text-stone-500 dark:hover:bg-stone-800",
                )}
              >
                {i + 1}
                {count > 0 && (
                  <span
                    aria-hidden="true"
                    className={cn("absolute bottom-0.5 size-1 rounded-full", isSelected ? "bg-white" : "bg-maple-500")}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
