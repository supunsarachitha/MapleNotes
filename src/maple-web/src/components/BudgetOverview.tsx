import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, CalendarRange, ChevronLeft, CircleAlert, CircleCheck, Info, MoreHorizontal, Pencil, Scissors, Trash2, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { isFinished, shortMoney, stillExpected, type Budget, type Forecast } from "../lib/budgets";
import { dayNumber } from "../lib/dayKeys";
import type { usePatchNote } from "../lib/queries";
import { Link } from "../lib/router";
import type { Note } from "../lib/types";
import { ForecastBar, StatusChip, useBudgetCurrency } from "./BudgetParts";
import { dayText } from "./BudgetSheets";
import type { OpenSheet } from "./BudgetCosts";
import { MenuItem } from "./NoteCard";
import type { useRemoveNote } from "./NoteRemoval";
import type { useToast } from "./Toaster";
import { IconButton, cn } from "./ui";

/* The top of a budget project's page: its header, the forecast, the chart and the advice. */


/** Amounts in the chart's labels: short, e.g. "Rs 450K". */
function useShortMoney(): (hundredths: number) => string {
  const currency = useBudgetCurrency();
  return (hundredths) => shortMoney(hundredths, currency);
}

/**
 * The spending so far (solid steps) and the forecast to the end date (dashed), against the budget (dotted line), with
 * today marked and a red dot where the money runs out. Screen readers get the same as one sentence.
 */
export function BudgetChart({ budget, forecast: f, today, money }: { budget: Budget; forecast: Forecast; today: string; money: (n: number) => string }) {
  const short = useShortMoney();
  const [W, H, L, R, T, B] = [340, 176, 8, 8, 20, 22];
  const s = dayNumber(budget.start)!;
  const e = Math.max(dayNumber(budget.end)!, s + 1);
  const now = Math.min(Math.max(dayNumber(today)!, s), e);
  const max = Math.max(f.total, budget.budget, 1) * 1.08;
  const x = (d: number) => L + ((d - s) / (e - s)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const points = (list: Array<[number, number]>) => list.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  let running = 0;
  const spent: Array<[number, number]> = [[s, 0]];
  for (const line of [...budget.spent].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = Math.min(Math.max(dayNumber(line.date)!, s), e);
    spent.push([d, running]);
    running += line.amount;
    spent.push([d, running]);
  }
  spent.push([now, running]);
  const ahead: Array<[number, number]> = [[now, running]];
  if (f.method === "plan") {
    let v = running;
    // Only what's left of each expected cost is still to come.
    for (const line of stillExpected(budget).sort((a, b) => a.date.localeCompare(b.date))) {
      const d = Math.min(Math.max(dayNumber(line.date)!, now), e);
      ahead.push([d, v]);
      v += line.amount;
      ahead.push([d, v]);
    }
    ahead.push([e, v]);
    if (f.allowance) ahead.push([e, v + f.allowance]);
  } else ahead.push([e, f.total]);
  const runsOut = f.runsOut && f.runsOut !== "already" && f.runsOut !== "allowance" ? dayNumber(f.runsOut) : f.runsOut === "allowance" ? e : null;
  // Above the end of the forecast line, and above the budget line too when the two are close.
  const totalY = Math.abs(y(f.total) - y(budget.budget)) < 14 ? Math.min(y(f.total), y(budget.budget)) - 6 : y(f.total) - 6;

  return (
    <figure className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Spent ${money(f.spent)} so far; forecast ${money(f.total)} by ${dayText(budget.end)}, against a budget of ${money(budget.budget)}.`}
        className="h-auto w-full text-stone-900 dark:text-stone-100"
      >
        <line x1={L} x2={W - R} y1={y(budget.budget)} y2={y(budget.budget)} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="2 3" />
        <text x={L + 2} y={y(budget.budget) - 5} fontSize={10} className="fill-stone-500 dark:fill-stone-400">
          Budget {short(budget.budget)}
        </text>
        <line x1={x(now)} x2={x(now)} y1={T} y2={H - B} className="stroke-stone-300 dark:stroke-stone-700" strokeWidth={1.5} />
        <text x={x(now)} y={T - 6} fontSize={10} textAnchor={x(now) < 60 ? "start" : x(now) > W - 60 ? "end" : "middle"} className="fill-stone-500 dark:fill-stone-400">
          Today {dayText(today)}
        </text>
        <polyline points={points(ahead)} fill="none" className="stroke-maple-400" strokeWidth={2.5} strokeDasharray="5 4" strokeLinejoin="round" />
        <polyline points={points(spent)} fill="none" className="stroke-maple-600 dark:stroke-maple-500" strokeWidth={3} strokeLinejoin="round" />
        {runsOut !== null && (
          <circle cx={x(Math.min(Math.max(runsOut, s), e))} cy={y(budget.budget)} r={5} className="fill-red-600 stroke-white dark:stroke-stone-900" strokeWidth={2} />
        )}
        <text
          x={W - R}
          y={totalY}
          fontSize={11}
          fontWeight={700}
          textAnchor="end"
          className={f.difference > 0 ? "fill-red-700 dark:fill-red-400" : "fill-stone-900 dark:fill-stone-100"}
        >
          {short(f.total)}
        </text>
        <text x={x(s)} y={H - 6} fontSize={10} className="fill-stone-500 dark:fill-stone-400">
          {dayText(budget.start)}
        </text>
        <text x={x(e)} y={H - 6} fontSize={10} textAnchor="end" className="fill-stone-500 dark:fill-stone-400">
          {dayText(budget.end)}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 dark:text-stone-300" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-1 w-4 rounded bg-maple-600 dark:bg-maple-500" /> Spent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-1 w-4 rounded bg-[repeating-linear-gradient(90deg,var(--color-maple-400)_0_5px,transparent_5px_8px)]" /> Forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0.5 w-4 rounded bg-stone-500" /> Budget
        </span>
      </figcaption>
    </figure>
  );
}

function Tip({ icon: Icon, tone, children }: { icon: typeof Info; tone?: "bad" | "ok"; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", tone === "bad" ? "text-red-700 dark:text-red-400" : tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-stone-500 dark:text-stone-400")}
        aria-hidden="true"
      />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Plain-words advice from the forecast: when the money runs out, what to change, and which category drives it. */
export function Advice({ budget, forecast: f, today, money }: { budget: Budget; forecast: Forecast; today: string; money: (n: number) => string }) {
  const b = (text: string) => <span className="whitespace-nowrap font-semibold">{text}</span>;
  const tips: ReactNode[] = [];
  const ended = isFinished(budget, today);
  if (ended) {
    tips.push(
      f.difference > 0 ? (
        <Tip key="end" icon={CircleAlert} tone="bad">
          The project went {b(money(f.difference))} over its budget.
        </Tip>
      ) : (
        <Tip key="end" icon={CircleCheck} tone="ok">
          The project finished with {b(money(-f.difference))} to spare.
        </Tip>
      ),
    );
  } else if (f.difference > 0) {
    tips.push(
      <Tip key="out" icon={CircleAlert} tone="bad">
        {f.runsOut === "already" ? (
          "You've already spent more than the budget."
        ) : f.runsOut === "allowance" ? (
          `Your listed costs fit the budget, but not with the ${budget.surprisePercent}% for surprises.`
        ) : (
          <>At this rate the budget runs out around {b(dayText(f.runsOut!))}.</>
        )}
      </Tip>,
    );
    tips.push(
      <Tip key="fix" icon={Scissors}>
        {f.method === "plan" ? (
          <>To finish on budget, trim {b(money(f.difference))} from what's still expected, or raise the budget.</>
        ) : (
          <>
            To finish on budget, keep to about {b(money(f.dailyLimit ?? 0))} a day until {dayText(budget.end)}.
          </>
        )}
      </Tip>,
    );
  } else {
    tips.push(
      <Tip key="ok" icon={CircleCheck} tone="ok">
        You should finish with {b(money(-f.difference))} to spare.
      </Tip>,
    );
  }
  if (f.worstCategory) {
    tips.push(
      <Tip key="cat" icon={TrendingUp}>
        Most of it comes from <span className="font-semibold">{f.worstCategory.name}</span>: forecast {money(f.worstCategory.forecast)} against{" "}
        {money(f.worstCategory.budget)}.
      </Tip>,
    );
  }
  return (
    <ul aria-label="Advice" className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      {tips}
    </ul>
  );
}

/** The project's name, a way back to Budgets, and its ⋯ menu (rename, budget and dates, archive, delete). */
export function ProjectHeader({
  note,
  budget,
  readOnly,
  removal,
  patch,
  toast,
  setSheet,
}: {
  note: Note;
  budget: Budget;
  readOnly: boolean;
  removal: ReturnType<typeof useRemoveNote>;
  patch: ReturnType<typeof usePatchNote>;
  toast: ReturnType<typeof useToast>;
  setSheet: (sheet: OpenSheet) => void;
}) {
  return (
      <header className="mb-4 flex items-center gap-1">
        <Link
          href="/budgets"
          aria-label="Back to Budgets"
          title="Back to Budgets"
          className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 break-words text-xl font-semibold">{budget.name}</h1>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="Project actions" className="size-11">
              <MoreHorizontal className="size-5" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-52 rounded-xl border border-stone-200 bg-white p-1 text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              {!readOnly && (
                <>
                  <MenuItem icon={Pencil} onSelect={() => setSheet({ type: "project", focus: "name" })}>
                    Rename
                  </MenuItem>
                  <MenuItem icon={CalendarRange} onSelect={() => setSheet({ type: "project", focus: "budget" })}>
                    Edit budget & dates
                  </MenuItem>
                </>
              )}
              <MenuItem
                icon={readOnly ? ArchiveRestore : Archive}
                onSelect={() =>
                  patch.mutate(
                    { id: note.id, isArchived: !readOnly },
                    {
                      onSuccess: () => toast.info(readOnly ? `Restored "${budget.name}".` : "Archived. Find it under Archived projects on Budgets."),
                      onError: () => toast.error("That didn't work. Please try again."),
                    },
                  )
                }
              >
                {readOnly ? "Restore" : "Archive"}
              </MenuItem>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
              <MenuItem icon={Trash2} danger onSelect={removal.start}>
                {removal.menuLabel}
              </MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
  );
}

/** The forecast final cost against the budget, with what is spent, still expected and when it ends. */
export function ForecastSummary({
  budget,
  forecast: f,
  ended,
  readOnly,
  money,
  setSheet,
}: {
  budget: Budget;
  forecast: Forecast;
  ended: boolean;
  readOnly: boolean;
  money: (n: number) => string;
  setSheet: (sheet: OpenSheet) => void;
}) {
  return (
      <section aria-label="Forecast" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <span className="min-w-0 flex-1">{ended ? "Final cost" : "Forecast final cost"}</span>
          <StatusChip status={f.status} />
        </div>
        <p className={cn("mt-1 break-words text-[34px] font-bold leading-tight tabular-nums tracking-tight", f.difference > 0 && "text-red-700 dark:text-red-400")}>
          {money(f.total)}
        </p>
        <p className="text-[15px] tabular-nums">
          {f.difference > 0 ? (
            <span className="font-semibold text-red-700 dark:text-red-400">{money(f.difference)} over</span>
          ) : (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{money(-f.difference)} under</span>
          )}{" "}
          your budget of {money(budget.budget)}
        </p>
        <div className="mt-4">
          <ForecastBar forecast={f} budget={budget.budget} money={money} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3 text-sm min-[360px]:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-stone-500 dark:text-stone-400">Spent</dt>
            <dd className="whitespace-nowrap font-semibold tabular-nums">{money(f.spent)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-stone-500 dark:text-stone-400">{f.method === "plan" ? "Still expected" : "Still to come"}</dt>
            <dd className="whitespace-nowrap font-semibold tabular-nums">{money(f.method === "plan" ? f.expected : f.total - f.spent)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-stone-500 dark:text-stone-400">{ended ? "Ended" : "Ends"}</dt>
            <dd className="font-semibold">{dayText(budget.end)}</dd>
          </div>
        </dl>
        {f.method === "plan" && !ended && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-stone-100 py-1 pl-3 pr-1 text-sm dark:bg-stone-800">
            <span className="min-w-0 flex-1">
              {budget.surprisePercent ? (
                <>
                  Includes <span className="font-semibold tabular-nums">{money(f.allowance)}</span> for surprises (
                  <span className="font-semibold">{budget.surprisePercent}%</span> of what's still expected)
                </>
              ) : (
                "No allowance for surprises"
              )}
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setSheet({ type: "allowance" })}
                aria-label={budget.surprisePercent ? "Change the allowance for surprises" : "Add an allowance for surprises"}
                className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-maple-700 hover:bg-white dark:text-maple-400 dark:hover:bg-stone-900"
              >
                {budget.surprisePercent ? "Change" : "Add"}
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setSheet({ type: "method" })}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
        >
          <Info className="size-4" aria-hidden="true" />
          {f.method === "plan" ? "Based on your plan" : "Based on your spending pace"}
        </button>
      </section>
  );
}
