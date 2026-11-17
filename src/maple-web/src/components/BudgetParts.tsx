import { Check, ChevronRight, Search } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  accountCurrency,
  allCurrencies,
  currencyName,
  currencySymbol,
  formatMoney,
  searchCurrencies,
  SURPRISE_CHOICES,
  type Forecast,
  type ForecastStatus,
} from "../lib/budgets";
import { usePreferences } from "../lib/preferences";
import { BottomSheet } from "./BottomSheet";
import { useSavePreferences } from "./PreferenceSections";
import { useToast } from "./Toaster";
import { Button, Section, cn } from "./ui";

const browserLanguages = () => (typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);

/** The account's budget currency (a guess from the browser's languages until one is chosen in Settings). */
export function useBudgetCurrency(): string {
  return accountCurrency(usePreferences().budgetCurrency, browserLanguages());
}

/** Formats hundredths in the account's budget currency. */
export function useMoney(): (hundredths: number) => string {
  const currency = useBudgetCurrency();
  return (hundredths) => formatMoney(hundredths, currency);
}

const STATUS: Record<ForecastStatus, { text: string; className: string }> = {
  over: { text: "Forecast over", className: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
  tight: { text: "Tight", className: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  ok: { text: "On budget", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

/** A project's status as a small coloured chip: "Forecast over", "Tight" or "On budget". */
export function StatusChip({ status, className }: { status: ForecastStatus; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS[status].className, className)}>
      {STATUS[status].text}
    </span>
  );
}

/**
 * The forecast as one bar: solid for what is spent, hatched up to the forecast final cost, with a tick at the budget.
 * The bar's scale leaves a little room past the larger of the forecast and the budget, so the tick never sits on the edge.
 */
export function ForecastBar({
  forecast,
  budget,
  money,
  thin = false,
}: {
  forecast: Pick<Forecast, "spent" | "total" | "difference">; budget: number; money: (n: number) => string; thin?: boolean }) {
  const max = Math.max(forecast.total, budget, 1) * 1.04;
  const width = (value: number) => `${Math.min(100, (Math.max(0, value) / max) * 100)}%`;
  const over = forecast.difference > 0;
  return (
    <div
      role="img"
      aria-label={`Spent ${money(forecast.spent)}, forecast ${money(forecast.total)}${budget > 0 ? `, budget ${money(budget)}` : ""}`}
      className={cn("relative w-full overflow-visible rounded-full bg-stone-200 dark:bg-stone-800", thin ? "h-2" : "h-3")}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full opacity-60",
          over
            ? "bg-[repeating-linear-gradient(135deg,var(--color-red-600)_0_3px,transparent_3px_6px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-red-400)_0_3px,transparent_3px_6px)]"
            : "bg-[repeating-linear-gradient(135deg,var(--color-maple-600)_0_3px,transparent_3px_6px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-maple-400)_0_3px,transparent_3px_6px)]",
        )}
        style={{ width: width(forecast.total) }}
      />
      <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-red-700 dark:bg-red-500" : "bg-maple-600 dark:bg-maple-500")} style={{ width: width(forecast.spent) }} />
      {budget > 0 && <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-stone-900 dark:bg-stone-100" style={{ left: width(budget) }} />}
    </div>
  );
}

const chip = (selected: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-maple-500",
    selected
      ? "border-maple-600 bg-maple-600 text-white dark:border-maple-500 dark:bg-maple-600"
      : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800",
  );

/** A percentage as the chips say it: "Off" or "10%". */
export const percentLabel = (percent: number) => (percent ? `${percent}%` : "Off");

/**
 * The allowance-for-surprises chips (Off, 5% … 25%, Other), with a number field for Other. Used in its sheet and in the
 * new-project form.
 */
export function SurpriseChoice({ value, onChange }: { value: number; onChange: (percent: number) => void }) {
  const preset = (SURPRISE_CHOICES as readonly number[]).includes(value);
  const [other, setOther] = useState(!preset);
  const [text, setText] = useState(preset ? "" : String(value));
  const inputId = useId();
  const hintId = useId();

  return (
    <div>
      <div role="radiogroup" aria-label="Percentage" className="flex flex-wrap gap-2">
        {SURPRISE_CHOICES.map((percent) => (
          <button
            key={percent}
            type="button"
            role="radio"
            aria-checked={!other && value === percent}
            className={chip(!other && value === percent)}
            onClick={() => {
              setOther(false);
              onChange(percent);
            }}
          >
            {percentLabel(percent)}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={other} className={chip(other)} onClick={() => setOther(true)}>
          Other
        </button>
      </div>
      {other && (
        <div className="mt-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            Your own percentage
          </label>
          <div className="mt-1 flex max-w-48 items-center rounded-xl border border-stone-300 bg-white focus-within:border-maple-500 dark:border-stone-700 dark:bg-stone-900">
            <input
              id={inputId}
              aria-describedby={hintId}
              inputMode="numeric"
              enterKeyHint="done"
              placeholder="12"
              value={text}
              onChange={(event) => {
                const clean = event.target.value.replace(/\D/g, "").slice(0, 3);
                setText(clean);
                if (clean !== "" && Number(clean) <= 100) onChange(Number(clean));
              }}
              className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-base outline-none"
            />
            <span className="pr-3 text-stone-500 dark:text-stone-400">%</span>
          </div>
          <p id={hintId} className={cn("mt-1 text-sm", text !== "" && Number(text) > 100 ? "text-red-700 dark:text-red-400" : "text-stone-500 dark:text-stone-400")}>
            From 0 to 100.
          </p>
        </div>
      )}
    </div>
  );
}

/** The sheet that picks an allowance for surprises: for new projects (Settings) or for one project, with its live effect. */
export function AllowanceSheet({
  open,
  onOpenChange,
  value,
  description,
  effect,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: number;
  description: ReactNode;
  effect?: (percent: number) => ReactNode;
  onSave: (percent: number) => void;
}) {
  const [percent, setPercent] = useState(value);
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setPercent(value);
        onOpenChange(next);
      }}
      title="Allowance for surprises"
      footer={
        <>
          <Button variant="ghost" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={() => onSave(percent)}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">{description}</p>
      <SurpriseChoice key={String(open)} value={percent} onChange={setPercent} />
      {effect && (
        <div aria-live="polite" className="mt-4">
          {effect(percent)}
        </div>
      )}
    </BottomSheet>
  );
}

/** The searchable list of every currency the browser knows, the suggested ones first. */
export function CurrencySheet({
  open,
  onOpenChange,
  value,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onPick: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const codes = useMemo(() => allCurrencies(), []);
  const { suggested, others } = useMemo(() => searchCurrencies(query, codes), [query, codes]);

  const row = (code: string) => (
    <li key={code}>
      <button
        type="button"
        aria-pressed={code === value}
        onClick={() => onPick(code)}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800",
          code === value && "bg-maple-50 dark:bg-maple-600/15",
        )}
      >
        <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 px-1 text-sm font-semibold dark:bg-stone-800">
          {currencySymbol(code)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-base">{currencyName(code)}</span>
          <span className="block text-sm text-stone-500 dark:text-stone-400">
            {code} · {formatMoney(123400, code)}
          </span>
        </span>
        {code === value && <Check className="size-5 shrink-0 text-maple-700 dark:text-maple-400" aria-hidden="true" />}
      </button>
    </li>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery("");
        onOpenChange(next);
      }}
      title="Currency"
    >
      <div className="sticky top-0 z-10 bg-white pb-2 dark:bg-stone-900">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, e.g. rupee or USD"
            aria-label="Search currencies"
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 w-full rounded-xl border border-stone-300 bg-white pl-9 pr-3 text-base outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900"
          />
        </div>
      </div>
      {suggested.length > 0 && (
        <>
          <h3 className="mt-2 px-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Suggested</h3>
          <ul aria-label="Suggested currencies">{suggested.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="mt-3 px-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {query.trim() ? "Other matches" : "All currencies"}
          </h3>
          <ul aria-label={query.trim() ? "Other matches" : "All currencies"}>{others.slice(0, query.trim() ? 60 : 400).map(row)}</ul>
        </>
      )}
      {suggested.length + others.length === 0 && (
        <p className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400">No currency matches “{query.trim()}”.</p>
      )}
    </BottomSheet>
  );
}

/** One tappable settings row: a symbol tile, a title and its current value, and a chevron. */
function SettingRow({ tile, title, value, onClick }: { tile: string; title: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800"
    >
      <span aria-hidden="true" className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg bg-maple-50 px-1 text-sm font-semibold text-maple-700 dark:bg-maple-600/15 dark:text-maple-400">
        {tile}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-stone-600 dark:text-stone-300">{value}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
    </button>
  );
}

/** Settings → Budgets: the account's one currency and the allowance for surprises new projects start with. */
export function BudgetsSection() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const toast = useToast();
  const currency = useBudgetCurrency();
  const [sheet, setSheet] = useState<"currency" | "allowance" | null>(null);
  const percent = preferences.budgetSurprisePercent;

  return (
    <>
      <Section title="Money">
        <SettingRow tile={currencySymbol(currency)} title="Currency" value={`${currencyName(currency)} · ${currency}`} onClick={() => setSheet("currency")} />
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Amounts look like <span className="font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatMoney(12500, currency)}</span> and{" "}
          <span className="font-semibold tabular-nums text-stone-900 dark:text-stone-100">{formatMoney(1250000, currency)}</span>. All your budgets use this
          currency. If you change it, the new symbol shows on every project, but the amounts stay the same numbers: nothing is converted.
        </p>
      </Section>
      <Section title="Forecast">
        <SettingRow
          tile={percent ? `${percent}%` : "0"}
          title="Allowance for surprises"
          value={percent ? `New projects add ${percent}% to what's still expected` : "Off for new projects"}
          onClick={() => setSheet("allowance")}
        />
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Each project can use its own percentage: tap <span className="font-medium">Change</span> on the project. Changing this doesn't change existing
          projects.
        </p>
      </Section>
      <CurrencySheet
        open={sheet === "currency"}
        onOpenChange={(open) => setSheet(open ? "currency" : null)}
        value={currency}
        onPick={(code) => {
          save({ budgetCurrency: code });
          setSheet(null);
          toast.info(`Budgets now use ${currencyName(code)}`);
        }}
      />
      <AllowanceSheet
        open={sheet === "allowance"}
        onOpenChange={(open) => setSheet(open ? "allowance" : null)}
        value={percent}
        description="The percentage new projects start with. Each project can change its own."
        onSave={(next) => {
          save({ budgetSurprisePercent: next });
          setSheet(null);
          toast.info(`New projects: ${percentLabel(next)} for surprises`);
        }}
      />
    </>
  );
}
