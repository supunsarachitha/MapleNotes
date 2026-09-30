import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { HabitCalendar } from "../components/HabitCalendar";
import { HabitChart } from "../components/HabitChart";
import { ArchivedHabitRow, DAY_GRID, HABIT_ROW, HabitRow } from "../components/HabitRow";
import { useToast } from "../components/Toaster";
import { Button, EmptyState, IconButton, Spinner, cn } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { addDays, dateOf, daysEnding, serializeHabit } from "../lib/habits";
import { usePreferences, useWeekStart } from "../lib/preferences";
import { useHabits, useInvalidateNotes } from "../lib/queries";
import type { Note } from "../lib/types";
import { FeatureOff } from "./TodoPage";

const weekdayName = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });
const dayOfMonth = new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "UTC" });
const shortRange = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const longRange = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function NewHabit() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateNotes();
  const toast = useToast();

  async function create(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await api.createNote(serializeHabit({ name: clean, days: [], notes: "" }), [], { kind: "Habit" });
      setName("");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not add the habit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void create(event)} className="flex gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New habit, e.g. Stretch"
        aria-label="New habit name"
        maxLength={300}
        className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900"
      />
      <Button type="submit" busy={saving} disabled={!name.trim()} className="h-11">
        <Plus className="size-4" aria-hidden="true" /> Add habit
      </Button>
    </form>
  );
}

/** The days shown, with arrows to go a week back and forward again (never past today). */
function WeekHeader({ days, today, weeksBack, onChange }: { days: string[]; today: string; weeksBack: number; onChange: (weeksBack: number) => void }) {
  const [first, last] = [days[0]!, days[days.length - 1]!];
  const range = (first.slice(0, 4) === today.slice(0, 4) ? shortRange : longRange).formatRange(dateOf(first), dateOf(last));

  return (
    <div className={cn(HABIT_ROW, "border-b border-stone-100 pb-2 dark:border-stone-800")}>
      <div className="flex min-w-0 items-center">
        <IconButton label="Earlier days" onClick={() => onChange(weeksBack + 1)} className="-ml-2">
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="min-w-0 text-sm font-medium tabular-nums text-stone-700 dark:text-stone-300" aria-live="polite">
          {range}
        </span>
        <IconButton label="Later days" disabled={weeksBack === 0} onClick={() => onChange(weeksBack - 1)}>
          <ChevronRight className="size-5" />
        </IconButton>
      </div>
      <div className={DAY_GRID} aria-hidden="true">
        {days.map((day) => (
          <span
            key={day}
            className={cn(
              "flex w-10 flex-col items-center text-xs leading-tight text-stone-500 sm:w-9 dark:text-stone-400",
              day === today && "font-semibold text-maple-700 dark:text-maple-400",
            )}
          >
            <span>{weekdayName.format(dateOf(day))}</span>
            <span className="tabular-nums">{dayOfMonth.format(dateOf(day))}</span>
          </span>
        ))}
      </div>
      <span className="hidden w-10 sm:order-3 sm:block" />
    </div>
  );
}

function ArchivedHabits({ notes }: { notes: Note[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (notes.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        Archived habits ({notes.length})
      </button>
      {open && (
        <ul id={id} className="mt-2 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white px-4 dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {notes.map((note) => (
            <ArchivedHabitRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Habits() {
  const today = localDateKey(useToday());
  const [weeksBack, setWeeksBack] = useState(0);
  const active = useHabits("active");
  const archived = useHabits("archived");
  const weekStart = useWeekStart();
  const days = daysEnding(addDays(today, -7 * weeksBack), 7);

  return (
    <>
      <NewHabit />
      <div className="mt-6">
        {active.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-maple-600" />
          </div>
        ) : active.isError ? (
          <EmptyState title="Could not load your habits">Check your connection, then reload the page.</EmptyState>
        ) : active.data.length === 0 ? (
          <EmptyState title="No habits yet">Add one above, then tick off each day you do it.</EmptyState>
        ) : (
          <>
            <section
              aria-label="Days done"
              className="rounded-2xl border border-stone-200 bg-white px-3 py-2 shadow-sm sm:px-4 dark:border-stone-800 dark:bg-stone-900"
            >
              <WeekHeader days={days} today={today} weeksBack={weeksBack} onChange={setWeeksBack} />
              <ul aria-label="Your habits" className="divide-y divide-stone-100 dark:divide-stone-800">
                {active.data.map((note) => (
                  <HabitRow key={note.id} note={note} days={days} today={today} />
                ))}
              </ul>
            </section>
            <HabitChart notes={active.data} today={today} weekStart={weekStart} />
            <HabitCalendar notes={active.data} today={today} weekStart={weekStart} />
          </>
        )}
      </div>
      <ArchivedHabits notes={archived.data ?? []} />
    </>
  );
}

/** The Habits tab: daily habits to tick off, a chart of the progress, and a month calendar. */
export function HabitsPage() {
  const { habitTracker } = usePreferences();

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Habits</h1>
      {habitTracker ? (
        <Habits />
      ) : (
        <FeatureOff title="The habit tracker is turned off">Your habits are kept and come back when you turn it on again.</FeatureOff>
      )}
    </>
  );
}
