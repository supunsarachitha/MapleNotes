import { Check, HandCoins, Paperclip, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { currencySymbol, finishExpected, progressOf, towardsOf, type Budget, type BudgetLine, type Forecast, type Progress } from "../lib/budgets";
import type { Attachment } from "../lib/types";
import {
  CostSheet,
  MethodSheet,
  PaidProgress,
  ProjectSheet,
  SharesSheet,
  ViewCostSheet,
  dayText,
  weekdayText,
  type CostMode,
} from "./BudgetSheets";
import type { useToast } from "./Toaster";
import { Button, cn } from "./ui";
import { ForecastBar } from "./BudgetParts";

/* A budget project's costs: the tabs, the Expected, Spent and Categories lists, and the sheets opened from them. */

/** The sheet open over a project, if any. */
export type OpenSheet =
  | { type: "cost"; mode: CostMode }
  | { type: "view"; kind: "spent" | "expected"; index: number }
  | { type: "allowance" | "method" | "shares" }
  | { type: "project"; focus: "name" | "budget" }
  | null;

type Item = { line: BudgetLine; index: number };


export type Tab = "expected" | "spent" | "categories";

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

/** The Expected / Spent / Categories tabs, kept in view while the list scrolls. */
export function CostTabs({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return (
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
  );
}

/** The open tab's list: the costs still expected, the spending by day, or the categories and their shares. */
export function CostPanel({
  tab,
  budget,
  forecast: f,
  expected,
  spentGroups,
  today,
  readOnly,
  money,
  setSheet,
}: {
  tab: Tab;
  budget: Budget;
  forecast: Forecast;
  expected: Item[];
  spentGroups: Map<string, Item[]>;
  today: string;
  readOnly: boolean;
  money: (n: number) => string;
  setSheet: (sheet: OpenSheet) => void;
}) {
  return (
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
  );
}

/** The sheet that is open: adding, viewing or paying a cost, how forecasts work, the shares, or the project. */
export function CostSheets({
  sheet,
  setSheet,
  budget,
  viewed,
  today,
  money,
  currency,
  readOnly,
  toast,
  save,
  upload,
  discard,
  attachment,
  setDeleting,
  setViewing,
}: {
  sheet: OpenSheet;
  setSheet: (sheet: OpenSheet) => void;
  budget: Budget;
  viewed: BudgetLine | undefined;
  today: string;
  money: (n: number) => string;
  currency: string;
  readOnly: boolean;
  toast: ReturnType<typeof useToast>;
  save: (next: Budget, dropped?: string[]) => void;
  upload: (file: File) => Promise<Attachment>;
  discard: (ids: string[]) => void;
  attachment: (id: string) => Attachment | undefined;
  setDeleting: (deleting: { kind: "spent" | "expected"; index: number }) => void;
  setViewing: (attachment: Attachment) => void;
}) {
  return (
    <>
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
    </>
  );
}
