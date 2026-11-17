import { Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { ForecastBar, StatusChip, useBudgetCurrency, useMoney } from "../components/BudgetParts";
import { useSavePreferences } from "../components/PreferenceSections";
import { useToast } from "../components/Toaster";
import { Button, EmptyState, Spinner, cn } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useBranding } from "../lib/branding";
import { currencySymbol, forecast, isFinished, parseAmount, parseBudget, serializeBudget, type Budget, type Forecast } from "../lib/budgets";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { addDays } from "../lib/habits";
import { usePreferences } from "../lib/preferences";
import { useBudgets, useInvalidateNotes } from "../lib/queries";
import { Link } from "../lib/router";
import type { Note } from "../lib/types";
import { FeatureOff } from "./TodoPage";

interface Project {
  note: Note;
  budget: Budget;
  forecast: Forecast;
}

const field =
  "h-11 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900";

/** Reads every project note, with its forecast as of today. */
export function useProjects(notes: Note[] | undefined, today: string): Project[] {
  const { budgetSurprisePercent } = usePreferences();
  return (notes ?? []).map((note) => {
    const budget = parseBudget(note.content, { today, surprisePercent: budgetSurprisePercent });
    return { note, budget, forecast: forecast(budget, today) };
  });
}

/** A new project: its name, budget and dates. Its first costs are added on the project's page. */
export function NewProjectSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: (note: Note) => void }) {
  const today = localDateKey(useToday());
  const preferences = usePreferences();
  const currency = useBudgetCurrency();
  const savePreferences = useSavePreferences();
  const invalidate = useInvalidateNotes();
  const toast = useToast();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 30));
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const ids = { name: useId(), amount: useId(), start: useId(), end: useId(), error: useId() };

  const budget = parseAmount(amount);
  const error = !name.trim()
    ? "Give the project a name."
    : budget === null || budget <= 0
      ? "Enter the budget, e.g. 450,000."
      : end < start
        ? "The end date can't be before the start."
        : null;

  function reset() {
    setName("");
    setAmount("");
    setStart(today);
    setEnd(addDays(today, 30));
    setTried(false);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (error || budget === null || saving) return;
    setSaving(true);
    try {
      const note = await api.createNote(
        serializeBudget({
          name: name.trim(),
          budget,
          start,
          end,
          surprisePercent: preferences.budgetSurprisePercent,
          categories: [],
          spent: [],
          expected: [],
          notes: "",
        }),
        [],
        { kind: "Budget" },
      );
      // The guessed currency becomes the account's own with its first project, so every device shows the same one.
      if (!preferences.budgetCurrency) savePreferences({ budgetCurrency: currency });
      await invalidate();
      toast.info(`Created ${name.trim()}`);
      reset();
      onOpenChange(false);
      onCreated?.(note);
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : "Could not create the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      footer={
        <>
          <Button variant="ghost" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-project" busy={saving} className="h-11 flex-1">
            Create project
          </Button>
        </>
      }
    >
      <form id="new-project" onSubmit={(event) => void create(event)} noValidate className="flex flex-col gap-4 pt-1">
        <div>
          <label htmlFor={ids.name} className="text-sm font-medium">
            Name
          </label>
          <input
            id={ids.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Kitchen renovation"
            maxLength={200}
            enterKeyHint="next"
            autoComplete="off"
            className={cn(field, "mt-1")}
          />
        </div>
        <div>
          <label htmlFor={ids.amount} className="text-sm font-medium">
            Budget
          </label>
          <div className="mt-1 flex items-center rounded-xl border border-stone-300 bg-white focus-within:border-maple-500 dark:border-stone-700 dark:bg-stone-900">
            <span className="pl-3 font-semibold text-stone-500 dark:text-stone-400" aria-hidden="true">
              {currencySymbol(currency)}
            </span>
            <input
              id={ids.amount}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              enterKeyHint="next"
              placeholder="450,000"
              autoComplete="off"
              className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-xl font-semibold tabular-nums outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor={ids.start} className="text-sm font-medium">
              Starts
            </label>
            <input id={ids.start} type="date" value={start} onChange={(event) => setStart(event.target.value)} className={cn(field, "mt-1 px-2")} />
          </div>
          <div className="min-w-0">
            <label htmlFor={ids.end} className="text-sm font-medium">
              Ends
            </label>
            <input id={ids.end} type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={cn(field, "mt-1 px-2")} />
          </div>
        </div>
        {tried && error && (
          <p id={ids.error} role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}

/** One project on the list: its name, status, forecast against the budget, and what is spent. */
function ProjectCard({ project, money }: { project: Project; money: (n: number) => string }) {
  const { note, budget, forecast: f } = project;
  const over = f.difference > 0;
  return (
    <li>
      <Link
        href={`/budgets/${note.id}`}
        className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-stone-300 focus-visible:outline-2 focus-visible:outline-maple-500 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
      >
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold">{budget.name}</h2>
          <StatusChip status={f.status} />
        </div>
        <p className="mt-0.5 text-sm tabular-nums text-stone-600 dark:text-stone-300">
          Forecast <span className={cn("font-semibold", over ? "text-red-700 dark:text-red-400" : "text-stone-900 dark:text-stone-100")}>{money(f.total)}</span> of{" "}
          {money(budget.budget)}
        </p>
        <div className="mt-3">
          <ForecastBar forecast={f} budget={budget.budget} money={money} thin />
        </div>
        <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm tabular-nums text-stone-600 dark:text-stone-300">
          <span className="whitespace-nowrap">Spent {money(f.spent)}</span>
          {over ? (
            <span className="whitespace-nowrap font-semibold text-red-700 dark:text-red-400">{money(f.difference)} over</span>
          ) : (
            <span className="whitespace-nowrap">{money(-f.difference)} to spare</span>
          )}
        </p>
      </Link>
    </li>
  );
}

function Budgets() {
  const today = localDateKey(useToday());
  const { appName } = useBranding();
  const money = useMoney();
  const notes = useBudgets("active");
  const projects = useProjects(notes.data, today);
  const [show, setShow] = useState<"active" | "finished">("active");
  const [creating, setCreating] = useState(false);
  const active = projects.filter((p) => !isFinished(p.budget, today));
  const shown = show === "active" ? active : projects.filter((p) => isFinished(p.budget, today));
  const totalBudget = active.reduce((sum, p) => sum + p.budget.budget, 0);
  const totalForecast = active.reduce((sum, p) => sum + p.forecast.total, 0);

  return (
    <>
      {notes.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading budgets">
          <div className="h-16 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
          <div className="h-32 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
          <Spinner className="sr-only" />
        </div>
      ) : notes.isError ? (
        <EmptyState title="Could not load your budgets">Check your connection, then reload the page.</EmptyState>
      ) : projects.length === 0 ? (
        <EmptyState title="See what a project will really cost">
          Give a project a budget, add what you expect to pay and what you've paid. {appName} forecasts the final cost and warns you early if it's heading
          over.
        </EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-2 divide-x divide-stone-200 rounded-2xl border border-stone-200 bg-white shadow-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            <div className="min-w-0 px-4 py-3">
              <dt className="text-xs text-stone-500 dark:text-stone-400">Budgets (active)</dt>
              <dd className="break-words text-lg font-semibold tabular-nums">{money(totalBudget)}</dd>
            </div>
            <div className="min-w-0 px-4 py-3">
              <dt className="text-xs text-stone-500 dark:text-stone-400">Forecast</dt>
              <dd className={cn("break-words text-lg font-semibold tabular-nums", totalForecast > totalBudget && "text-red-700 dark:text-red-400")}>
                {money(totalForecast)}
              </dd>
            </div>
          </dl>
          <div role="group" aria-label="Show" className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-stone-200 p-1 dark:bg-stone-800">
            {(["active", "finished"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={show === value}
                onClick={() => setShow(value)}
                className={cn(
                  "h-10 rounded-full text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-maple-500",
                  show === value
                    ? "bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100"
                    : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100",
                )}
              >
                {value === "active" ? "Active" : "Finished"}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
              {show === "active" ? "No active projects. Start one below." : "No finished projects yet."}
            </p>
          ) : (
            <ul aria-label={show === "active" ? "Active projects" : "Finished projects"} className="mt-4 flex flex-col gap-3">
              {shown.map((project) => (
                <ProjectCard key={project.note.id} project={project} money={money} />
              ))}
            </ul>
          )}
        </>
      )}
      <BottomBar>
        <Button className="h-12 w-full text-base" onClick={() => setCreating(true)}>
          <Plus className="size-5" aria-hidden="true" /> New project
        </Button>
      </BottomBar>
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

/**
 * The page's main actions, fixed at the bottom of a phone's screen within reach of the thumb (clear of the home
 * indicator); on wide screens, where the side menu shows, they sit under the page instead.
 */
export function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none dark:border-stone-800 dark:bg-stone-900/95 lg:dark:bg-transparent">
      <div className="mx-auto flex max-w-2xl gap-2">{children}</div>
    </div>
  );
}

/** The Budgets page: projects with a budget, and a forecast of what each will really cost. */
export function BudgetsPage() {
  const { budgets } = usePreferences();
  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Budgets</h1>
      </header>
      {budgets ? (
        <Budgets />
      ) : (
        <FeatureOff title="Budgets are turned off">Your projects are kept and come back when you turn Budgets on again.</FeatureOff>
      )}
    </>
  );
}
