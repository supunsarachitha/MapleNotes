import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  HandCoins,
  Info,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { BottomBar } from "../components/BottomBar";
import { AllowanceSheet, ForecastBar, StatusChip, percentLabel, useBudgetCurrency, useMoney } from "../components/BudgetParts";
import {
  CostSheet,
  ForecastEffect,
  MethodSheet,
  PaidProgress,
  ProjectSheet,
  SharesSheet,
  ViewCostSheet,
  dayText,
  weekdayText,
  type CostMode,
} from "../components/BudgetSheets";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImageViewer } from "../components/ImageViewer";
import { MenuItem } from "../components/NoteCard";
import { useRemoveNote } from "../components/NoteRemoval";
import { useToast } from "../components/Toaster";
import { Button, EmptyState, IconButton, cn } from "../components/ui";
import { api, uploadAttachment, ApiError } from "../lib/api";
import {
  currencySymbol,
  finishExpected,
  forecast,
  isFinished,
  parseBudget,
  progressOf,
  removeCost,
  serializeBudget,
  shortMoney,
  stillExpected,
  towardsOf,
  type Budget,
  type BudgetLine,
  type Forecast,
  type Progress,
} from "../lib/budgets";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { dayNumber } from "../lib/dayKeys";
import { useNoteEditor } from "../lib/noteEditor";
import { usePreferences } from "../lib/preferences";
import { useBudgets, usePatchNote } from "../lib/queries";
import { Link } from "../lib/router";
import { shrinkPhoto } from "../lib/shrinkPhoto";
import type { Attachment, Note } from "../lib/types";
import { saveErrorMessage } from "../lib/apiError";

const receiptsOf = (budget: Budget) => [...budget.spent, ...budget.expected].flatMap((line) => (line.receipt ? [line.receipt] : []));
const byDate = (a: { line: BudgetLine }, b: { line: BudgetLine }) => a.line.date.localeCompare(b.line.date);

/** Amounts in the chart's labels: short, e.g. "Rs 450K". */
function useShortMoney(): (hundredths: number) => string {
  const currency = useBudgetCurrency();
  return (hundredths) => shortMoney(hundredths, currency);
}

/**
 * The spending so far (solid steps) and the forecast to the end date (dashed), against the budget (dotted line), with
 * today marked and a red dot where the money runs out. Screen readers get the same as one sentence.
 */
function BudgetChart({ budget, forecast: f, today, money }: { budget: Budget; forecast: Forecast; today: string; money: (n: number) => string }) {
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
function Advice({ budget, forecast: f, today, money }: { budget: Budget; forecast: Forecast; today: string; money: (n: number) => string }) {
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

type Tab = "expected" | "spent" | "categories";

function CostRow({
  line,
  late,
  money,
  onOpen,
  onPay,
  onPayPart,
  progress,
  meta,
}: {
  line: BudgetLine;
  late?: boolean;
  money: (n: number) => string;
  onOpen: () => void;
  onPay?: () => void;
  onPayPart?: () => void;
  /** Shown once something has been paid towards the cost. */
  progress?: Progress;
  meta: ReactNode;
}) {
  const name = line.title || line.category;
  const side =
    "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-maple-500";
  return (
    <li className="flex items-stretch">
      <button type="button" onClick={onOpen} className="flex min-h-14 min-w-0 flex-1 flex-col px-4 py-3 text-left hover:bg-stone-50 dark:hover:bg-stone-800/60">
        <span className="flex w-full items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[15px] font-medium">{name}</span>
            <span className={cn("block text-sm", late ? "text-amber-800 dark:text-amber-300" : "text-stone-500 dark:text-stone-400")}>
              {meta}
              {line.receipt && (
                <>
                  {" · "}
                  <Paperclip className="inline size-3.5 align-[-2px]" aria-hidden="true" />
                  <span className="sr-only">has a photo</span>
                </>
              )}
            </span>
            {line.details && <span className="mt-0.5 line-clamp-2 block whitespace-pre-line break-words text-sm text-stone-600 dark:text-stone-300">{line.details}</span>}
          </span>
          <span className="shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums">{money(line.amount)}</span>
        </span>
        {progress && <PaidProgress progress={progress} money={money} className="mt-2 w-full" />}
      </button>
      {(onPay || onPayPart) && (
        // Pay part above Paid, so both stay in reach without squeezing the cost's name on a narrow phone.
        <span className="flex w-16 shrink-0 flex-col divide-y divide-stone-100 border-l border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          {onPayPart && (
            <button
              type="button"
              onClick={onPayPart}
              aria-label={`Pay part of ${name}`}
              className={cn(side, "text-maple-700 hover:bg-maple-50 dark:text-maple-400 dark:hover:bg-maple-600/15")}
            >
              <HandCoins className="size-5" aria-hidden="true" />
              <span className="whitespace-nowrap">Pay part</span>
            </button>
          )}
          {onPay && (
            <button
              type="button"
              onClick={onPay}
              aria-label={`Mark ${name} as paid`}
              className={cn(side, "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10")}
            >
              <Check className="size-5" aria-hidden="true" />
              Paid
            </button>
          )}
        </span>
      )}
    </li>
  );
}

const card = "overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900";
const groupHead = "mb-1.5 mt-4 flex justify-between gap-3 px-1 text-xs font-semibold text-stone-500 dark:text-stone-400";
/** Group labels are capitals; their amounts are not, so currency symbols such as "Rs" keep their case. */
const groupLabel = "uppercase tracking-wide";

function ProjectView({ note }: { note: Note }) {
  const today = localDateKey(useToday());
  const preferences = usePreferences();
  const money = useMoney();
  const currency = useBudgetCurrency();
  const toast = useToast();
  const patch = usePatchNote();
  const parse = useCallback((content: string) => parseBudget(content, { today, surprisePercent: preferences.budgetSurprisePercent }), [today, preferences.budgetSurprisePercent]);
  const [budget, commit] = useNoteEditor<Budget>(
    note,
    parse,
    serializeBudget,
    (error) => toast.error(saveErrorMessage(error, "A change to this project could not be saved. Please try again.")),
    receiptsOf,
  );
  const [tab, setTab] = useState<Tab>("expected");
  const [sheet, setSheet] = useState<
    | { type: "cost"; mode: CostMode }
    | { type: "view"; kind: "spent" | "expected"; index: number }
    | { type: "allowance" | "method" | "shares" }
    | { type: "project"; focus: "name" | "budget" }
    | null
  >(null);
  const [deleting, setDeleting] = useState<{ kind: "spent" | "expected"; index: number } | null>(null);
  const [extra, setExtra] = useState<Record<string, Attachment>>({});
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const removal = useRemoveNote(note, {
    noun: "project",
    confirmTitle: "Delete this project?",
    confirmDescription: `"${budget.name}" and all its costs will be deleted permanently.`,
  });
  const f = forecast(budget, today);
  const readOnly = note.isArchived;
  const ended = isFinished(budget, today);
  const attachment = (id: string) => note.attachments.find((a) => a.id === id) ?? extra[id];

  async function upload(file: File): Promise<Attachment> {
    try {
      const ready = preferences.shrinkPhotos && file.type.startsWith("image/") ? await shrinkPhoto(file, preferences.photoSize) : file;
      const added = await uploadAttachment(ready, () => {});
      setExtra((current) => ({ ...current, [added.id]: added }));
      return added;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The photo could not be uploaded. Please try again.");
      throw error;
    }
  }
  const discard = (ids: string[]) => ids.forEach((id) => void api.deleteAttachment(id).catch(() => undefined));

  /** Saves a change, then deletes the photos it dropped (once the note no longer holds them). */
  function save(next: Budget, dropped: string[] = []) {
    void commit(next).then(() => discard(dropped));
  }

  const expected = budget.expected.map((line, index) => ({ line, index })).sort(byDate);
  const spentGroups = new Map<string, Array<{ line: BudgetLine; index: number }>>();
  for (const item of budget.spent.map((line, index) => ({ line, index })).sort((a, b) => b.line.date.localeCompare(a.line.date))) {
    spentGroups.set(item.line.date, [...(spentGroups.get(item.line.date) ?? []), item]);
  }
  const viewed = sheet?.type === "view" ? budget[sheet.kind][sheet.index] : undefined;
  const effectOf = (percent: number) => (
    <ForecastEffect before={f} after={forecast({ ...budget, surprisePercent: percent }, today)} money={money} />
  );

  return (
    <>
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
      {removal.dialog}

      {readOnly && (
        <p className="mb-4 rounded-xl bg-stone-200 px-4 py-3 text-sm dark:bg-stone-800">This project is archived. Restore it from the ⋯ menu to change it.</p>
      )}

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

      <div className="mt-3 flex flex-col gap-3">
        <BudgetChart budget={budget} forecast={f} today={today} money={money} />
        {f.pastDue.length > 0 && !ended && (
          <p role="status" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {f.pastDue.length === 1
              ? "1 expected cost is past due. Mark it paid or move the date."
              : `${f.pastDue.length} expected costs are past due. Mark them paid or move the date.`}
          </p>
        )}
        <Advice budget={budget} forecast={f} today={today} money={money} />
      </div>

      <div className="sticky top-14 z-10 -mx-4 mt-4 bg-stone-100 px-4 py-2 lg:top-0 dark:bg-stone-950">
        <div role="tablist" aria-label="Costs" className="grid grid-cols-3 gap-1 rounded-full bg-stone-200 p-1 dark:bg-stone-800">
          {(
            [
              ["expected", "Expected"],
              ["spent", "Spent"],
              ["categories", "Categories"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`budget-tab-${value}`}
              aria-selected={tab === value}
              aria-controls="budget-panel"
              onClick={() => setTab(value)}
              className={cn(
                "h-10 min-w-0 rounded-full px-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-maple-500",
                tab === value ? "bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100" : "text-stone-600 dark:text-stone-400",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id="budget-panel" aria-labelledby={`budget-tab-${tab}`}>
        {tab === "expected" &&
          (expected.length ? (
            <>
              <div className={groupHead}>
                <span className={groupLabel}>Still expected</span>
                <span className="tabular-nums">{money(f.expected)}</span>
              </div>
              <ul aria-label="Expected costs" className={cn(card, "divide-y divide-stone-100 dark:divide-stone-800")}>
                {expected.map(({ line, index }) => {
                  const progress = progressOf(budget, line);
                  const late = line.date < today && progress.left > 0;
                  return (
                    <CostRow
                      key={index}
                      line={line}
                      late={late}
                      money={money}
                      progress={progress.paid > 0 ? progress : undefined}
                      meta={
                        <>
                          {line.category} · <span className="whitespace-nowrap">{`${late ? "was due " : ""}${dayText(line.date)}`}</span>
                        </>
                      }
                      onOpen={() => setSheet({ type: "view", kind: "expected", index })}
                      onPayPart={readOnly ? undefined : () => setSheet({ type: "cost", mode: { kind: "spent", part: index } })}
                      onPay={readOnly ? undefined : () => setSheet({ type: "cost", mode: { kind: "expected", pay: index } })}
                    />
                  );
                })}
              </ul>
              {!readOnly && (
                <p className="mx-1 mt-2 text-[13px] text-stone-500 dark:text-stone-400">
                  Tap a cost to see its details. Tap Paid when you pay one, or Pay part when you pay some of it. You can change the amount if the real price was
                  different, and the forecast updates.
                </p>
              )}
            </>
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center dark:border-stone-700">
              <p className="text-sm text-stone-600 dark:text-stone-300">Nothing expected yet.</p>
              <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">
                {f.method === "pace"
                  ? "This project is forecast from how fast you've been spending. Add expected costs to forecast from a plan instead."
                  : "Add the costs you know are coming to forecast the final total."}
              </p>
            </div>
          ))}
        {tab === "spent" &&
          (spentGroups.size ? (
            [...spentGroups].map(([day, items]) => (
              <section key={day} aria-label={weekdayText(day)}>
                <div className={groupHead}>
                  <span className={groupLabel}>{weekdayText(day)}</span>
                  <span className="tabular-nums">{money(items.reduce((sum, item) => sum + item.line.amount, 0))}</span>
                </div>
                <ul className={cn(card, "divide-y divide-stone-100 dark:divide-stone-800")}>
                  {items.map(({ line, index }) => {
                    const towards = towardsOf(budget, line);
                    return (
                      <CostRow
                        key={index}
                        line={line}
                        money={money}
                        meta={
                          towards ? (
                            <>
                              {line.category} · towards {towards.title || towards.category}
                            </>
                          ) : (
                            line.category
                          )
                        }
                        onOpen={() => setSheet({ type: "view", kind: "spent", index })}
                      />
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <p className="mt-2 rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
              Nothing spent yet. Tap Spent below when you pay for something.
            </p>
          ))}
        {tab === "categories" && budget.categories.length > 0 && (
          <div className={groupHead}>
            <span className={groupLabel}>Shares</span>
            <span className="tabular-nums">
              {money(budget.categories.reduce((sum, c) => sum + c.amount, 0))} of {money(budget.budget)}
            </span>
          </div>
        )}
        {tab === "categories" &&
          (f.categories.length ? (
            <ul aria-label="Categories" className={cn(card, budget.categories.length ? "" : "mt-2", "divide-y divide-stone-100 dark:divide-stone-800")}>
              {f.categories.map((c) => {
                const difference = c.forecast - c.budget;
                return (
                  <li key={c.name} className="px-4 py-3">
                    <div className="mb-2 flex items-start gap-2">
                      <span className="min-w-0 flex-1 break-words font-semibold">{c.name}</span>
                      {c.budget > 0 && (
                        <span
                          className={cn(
                            "shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                            difference > 0
                              ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
                          )}
                        >
                          {difference > 0 ? `${money(difference)} over` : `${money(-difference)} spare`}
                        </span>
                      )}
                    </div>
                    <ForecastBar forecast={{ spent: c.spent, total: c.forecast, difference: c.budget > 0 ? difference : 0 }} budget={c.budget} money={money} thin />
                    <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-sm tabular-nums text-stone-600 dark:text-stone-300">
                      <span className="whitespace-nowrap">Spent {money(c.spent)}</span>
                      <span className="whitespace-nowrap">
                        Forecast <span className="font-semibold text-stone-900 dark:text-stone-100">{money(c.forecast)}</span>
                        {c.budget > 0 && ` / ${money(c.budget)}`}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
              Costs are grouped by the category you give them.
            </p>
          ))}
        {tab === "categories" && !readOnly && (
          <>
            <Button variant="secondary" className="mt-3 h-11 w-full text-base" onClick={() => setSheet({ type: "shares" })}>
              <Pencil className="size-4" aria-hidden="true" /> Edit shares
            </Button>
            {budget.categories.every((c) => c.amount === 0) && (
              <p className="mx-1 mt-2 text-[13px] text-stone-500 dark:text-stone-400">
                Give each category a share of the budget to see which one is heading over. Shares are optional.
              </p>
            )}
          </>
        )}
      </div>

      {!readOnly && (
        <BottomBar>
          <Button variant="secondary" className="h-12 flex-1 text-base" onClick={() => setSheet({ type: "cost", mode: { kind: "expected" } })}>
            <CalendarClock className="size-5" aria-hidden="true" /> Expect
          </Button>
          <Button className="h-12 flex-1 text-base" onClick={() => setSheet({ type: "cost", mode: { kind: "spent" } })}>
            <Plus className="size-5" aria-hidden="true" /> Spent
          </Button>
        </BottomBar>
      )}

      {sheet?.type === "cost" && (
        <CostSheet
          budget={budget}
          mode={sheet.mode}
          today={today}
          money={money}
          symbol={currencySymbol(currency)}
          onClose={() => setSheet(null)}
          onSave={(next, dropped) => {
            save(next, dropped);
            const { mode } = sheet;
            const line = mode.pay !== undefined ? budget.expected[mode.pay] : undefined;
            const part = mode.part !== undefined ? budget.expected[mode.part] : undefined;
            toast.info(
              part
                ? `Paid ${money(next.spent.at(-1)?.amount ?? 0)} towards ${part.title || part.category}`
                : line
                  ? `${line.title || line.category} marked paid`
                  : mode.edit !== undefined
                    ? "Saved changes"
                    : "Saved",
            );
          }}
          onUpload={upload}
          onDiscard={discard}
        />
      )}
      {sheet?.type === "view" && viewed && (
        <ViewCostSheet
          line={viewed}
          kind={sheet.kind}
          today={today}
          money={money}
          attachment={viewed.receipt ? attachment(viewed.receipt) : undefined}
          readOnly={readOnly}
          onClose={() => setSheet(null)}
          onDelete={() => {
            setDeleting({ kind: sheet.kind, index: sheet.index });
            setSheet(null);
          }}
          onEdit={() => setSheet({ type: "cost", mode: { kind: sheet.kind, edit: sheet.index } })}
          onPay={() => setSheet({ type: "cost", mode: { kind: "expected", pay: sheet.index } })}
          progress={sheet.kind === "expected" ? progressOf(budget, viewed) : undefined}
          towards={(() => {
            const cost = sheet.kind === "spent" ? towardsOf(budget, viewed) : undefined;
            return cost ? cost.title || cost.category : undefined;
          })()}
          onPayPart={sheet.kind === "expected" ? () => setSheet({ type: "cost", mode: { kind: "spent", part: sheet.index } }) : undefined}
          onDone={
            sheet.kind === "expected"
              ? () => {
                  const { left } = progressOf(budget, viewed);
                  save(finishExpected(budget, sheet.index));
                  setSheet(null);
                  toast.info(left > 0 ? `${viewed.title || viewed.category} is done. The ${money(left)} left is out of the forecast.` : `${viewed.title || viewed.category} is done`);
                }
              : undefined
          }
          onOpenPayment={(index) => setSheet({ type: "view", kind: "spent", index })}
          onOpenReceipt={() => {
            const found = viewed.receipt ? attachment(viewed.receipt) : undefined;
            if (found) setViewing(found);
          }}
        />
      )}
      {sheet?.type === "method" && <MethodSheet onClose={() => setSheet(null)} />}
      {sheet?.type === "shares" && (
        <SharesSheet
          budget={budget}
          money={money}
          symbol={currencySymbol(currency)}
          onClose={() => setSheet(null)}
          onSave={(next) => {
            save(next);
            toast.info("Saved the shares");
          }}
        />
      )}
      {sheet?.type === "project" && (
        <ProjectSheet budget={budget} symbol={currencySymbol(currency)} focus={sheet.focus} onClose={() => setSheet(null)} onSave={(next) => save(next)} />
      )}
      <AllowanceSheet
        open={sheet?.type === "allowance"}
        onOpenChange={(open) => setSheet(open ? { type: "allowance" } : null)}
        value={budget.surprisePercent}
        description={
          <>
            A percentage of what's still expected in <span className="font-semibold">{budget.name}</span>, added to the forecast. Real costs usually come in higher
            than quotes. Renovations often run 10–20% over.
          </>
        }
        effect={effectOf}
        onSave={(percent) => {
          save({ ...budget, surprisePercent: percent });
          setSheet(null);
          toast.info(percent ? `Allowance for surprises: ${percentLabel(percent)}` : "Allowance for surprises turned off");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this cost?"
        description={(() => {
          const line = deleting ? budget[deleting.kind][deleting.index] : undefined;
          if (!deleting || !line) return "";
          const payments = deleting.kind === "expected" ? progressOf(budget, line).payments.length : 0;
          const towards = deleting.kind === "spent" ? towardsOf(budget, line) : undefined;
          return [
            `"${line.title}" (${money(line.amount)})${line.receipt ? " and its photo" : ""} will be deleted.`,
            payments === 1 ? "The payment made towards it stays as spent." : payments > 1 ? `The ${payments} payments made towards it stay as spent.` : "",
            towards ? `Its amount goes back into what's left of ${towards.title || towards.category}.` : "",
          ]
            .filter(Boolean)
            .join(" ");
        })()}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleting) return;
          const line = budget[deleting.kind][deleting.index];
          save(removeCost(budget, deleting.kind, deleting.index), line?.receipt ? [line.receipt] : []);
          setDeleting(null);
          toast.info("Deleted");
        }}
      />
      <ImageViewer images={viewing ? [viewing] : []} index={viewing ? 0 : null} onIndexChange={() => undefined} onClose={() => setViewing(null)} />
    </>
  );
}

/** One budget project: its forecast, chart, advice and costs, with sheets to add, edit and pay them. */
export function BudgetProjectPage({ id }: { id: string }) {
  const active = useBudgets("active");
  const archived = useBudgets("archived");
  const note = active.data?.find((n) => n.id === id) ?? archived.data?.find((n) => n.id === id);
  if (note) return <ProjectView key={note.id} note={note} />;
  if (active.isPending || archived.isPending)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the project">
        <div className="h-48 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
        <div className="h-40 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
      </div>
    );
  return (
    <EmptyState title="This project isn't here">
      It may have been moved to the trash.{" "}
      <Link href="/budgets" className="font-medium text-maple-700 underline dark:text-maple-400">
        Back to Budgets
      </Link>
    </EmptyState>
  );
}
