import { ChevronRight, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ForecastBar, StatusChip, useMoney } from "../components/BudgetParts";
import { NewProjectSheet } from "../components/NewProjectSheet";
import { Button, EmptyState, Spinner, cn } from "../components/ui";
import { useBranding } from "../lib/branding";
import { forecast, isFinished, parseBudget, type Budget, type Forecast } from "../lib/budgets";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { usePreferences } from "../lib/preferences";
import { useBudgets } from "../lib/queries";
import { Link, navigate, useLocation } from "../lib/router";
import type { Note } from "../lib/types";
import { BudgetProjectPage } from "./BudgetProjectPage";
import { FeatureOff } from "./TodoPage";

interface Project {
  note: Note;
  budget: Budget;
  forecast: Forecast;
}

/** Reads every project note, with its forecast as of today. */
export function useProjects(notes: Note[] | undefined, today: string): Project[] {
  const { budgetSurprisePercent } = usePreferences();
  return (notes ?? []).map((note) => {
    const budget = parseBudget(note.content, { today, surprisePercent: budgetSurprisePercent });
    return { note, budget, forecast: forecast(budget, today) };
  });
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
  const archived = useBudgets("archived");
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
      <ArchivedProjects notes={archived.data ?? []} today={today} money={money} />
      <NewProjectSheet open={creating} onOpenChange={setCreating} onCreated={(note) => navigate(`/budgets/${note.id}`)} />
    </>
  );
}

/** Archived projects, folded away under the list; each still opens (read-only until restored). */
function ArchivedProjects({ notes, today, money }: { notes: Note[]; today: string; money: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const projects = useProjects(notes, today);
  if (projects.length === 0) return null;
  return (
    <section className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-medium text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        Archived projects ({projects.length})
      </button>
      {open && (
        <ul id={id} aria-label="Archived projects" className="mt-2 flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectCard key={project.note.id} project={project} money={money} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The page's main actions, fixed at the bottom of a phone's screen within reach of the thumb (clear of the home
 * indicator); on wide screens, where the side menu shows, they sit under the page instead.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none dark:border-stone-800 dark:bg-stone-900/95 lg:dark:bg-transparent">
      <div className="mx-auto flex max-w-2xl gap-2">{children}</div>
    </div>
  );
}

/** The Budgets page: projects with a budget, and a forecast of what each will really cost. */
export function BudgetsPage() {
  const { budgets } = usePreferences();
  const { path } = useLocation();
  const id = path.startsWith("/budgets/") ? decodeURIComponent(path.slice("/budgets/".length)) : "";
  if (budgets && id) return <BudgetProjectPage id={id} />;
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
