import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { api, ApiError } from "../lib/api";
import { currencyName, currencySymbol, mergeCategories, parseAmount, serializeBudget, type BudgetLine } from "../lib/budgets";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { addDays, dayNumber } from "../lib/habits";
import { usePreferences } from "../lib/preferences";
import { useInvalidateNotes } from "../lib/queries";
import type { Note } from "../lib/types";
import { BottomSheet } from "./BottomSheet";
import { useBudgetCurrency, useMoney, SurpriseChoice } from "./BudgetParts";
import { AmountField, chipClass, fieldClass } from "./BudgetSheets";
import { useSavePreferences } from "./PreferenceSections";
import { useToast } from "./Toaster";
import { Button, IconButton, Switch, cn } from "./ui";

const NAME_IDEAS = ["Renovation", "Trip", "Wedding", "Monthly groceries"];
const COST_IDEAS = ["Materials", "Labour", "Other"];

/**
 * A new project in two steps: its name, budget and dates; then the costs already known and the allowance for surprises,
 * which make its first forecast (shown live). Both steps are a bottom sheet; the second can be skipped, and a project
 * with nothing expected is forecast from its spending pace.
 */
export function NewProjectSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: (note: Note) => void }) {
  const today = localDateKey(useToday());
  const preferences = usePreferences();
  const currency = useBudgetCurrency();
  const money = useMoney();
  const savePreferences = useSavePreferences();
  const invalidate = useInvalidateNotes();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 30));
  const [costs, setCosts] = useState<Array<{ name: string; amount: string }>>(COST_IDEAS.map(() => ({ name: "", amount: "" })));
  const [percent, setPercent] = useState(preferences.budgetSurprisePercent);
  const [asCategories, setAsCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const ids = { name: useId(), amount: useId(), start: useId(), end: useId(), categories: useId() };
  const symbol = currencySymbol(currency);

  const budget = parseAmount(amount);
  const error = !name.trim()
    ? "Give the project a name."
    : budget === null || budget <= 0
      ? "Enter the budget, e.g. 450,000."
      : dayNumber(start) === null || dayNumber(end) === null || end < start
        ? "The end date can't be before the start."
        : null;
  const listed = costs.flatMap((cost, i) => {
    const value = parseAmount(cost.amount);
    return value !== null && value > 0 ? [{ name: cost.name.trim() || COST_IDEAS[i] || "Other", amount: value }] : [];
  });
  const listedTotal = listed.reduce((sum, cost) => sum + cost.amount, 0);
  const allowance = Math.round((listedTotal * percent) / 100);
  const firstForecast = listedTotal + allowance;

  function reset() {
    setStep(1);
    setName("");
    setAmount("");
    setStart(today);
    setEnd(addDays(today, 30));
    setCosts(COST_IDEAS.map(() => ({ name: "", amount: "" })));
    setPercent(preferences.budgetSurprisePercent);
    setAsCategories(true);
    setTried(false);
  }

  async function create() {
    if (error || budget === null || saving) return;
    setSaving(true);
    try {
      // Listed costs can become the categories, their amounts the shares; costs with the same name make one category.
      const categories = asCategories ? mergeCategories(listed) : [];
      const spelling = (cost: string) => categories.find((c) => c.name.toLowerCase() === cost.trim().toLowerCase())?.name ?? cost;
      // Known costs are expected by the end date until the owner gives them their own dates.
      const expected: BudgetLine[] = listed.map((cost) => ({ date: end, category: spelling(cost.name), amount: cost.amount, title: cost.name, details: "" }));
      const note = await api.createNote(
        serializeBudget({ name: name.trim(), budget, start, end, surprisePercent: percent, categories, spent: [], expected, notes: "" }),
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

  const steps = (
    <div className="mb-3 flex gap-1.5" aria-hidden="true">
      <i className="h-1 flex-1 rounded-full bg-maple-600" />
      <i className={cn("h-1 flex-1 rounded-full", step === 2 ? "bg-maple-600" : "bg-stone-200 dark:bg-stone-700")} />
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={step === 1 ? "New project" : "What do you expect to pay for?"}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-project" className="h-11 flex-1">
              Next
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="h-11 flex-1" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button className="h-11 flex-1" busy={saving} onClick={() => void create()}>
              Create project
            </Button>
          </>
        )
      }
    >
      {steps}
      {step === 1 ? (
        <form
          id="new-project"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (!error) setStep(2);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor={ids.name} className="text-sm font-medium">
              Name
            </label>
            <input
              id={ids.name}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Bathroom makeover"
              maxLength={200}
              enterKeyHint="next"
              autoComplete="off"
              className={cn(fieldClass, "mt-1")}
            />
            <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Name ideas">
              {NAME_IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setName(idea)} className={chipClass(false)}>
                  {idea}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor={ids.amount} className="text-sm font-medium">
              Budget
            </label>
            <AmountField id={ids.amount} symbol={symbol} value={amount} onChange={setAmount} />
            <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">In {currencyName(currency)}, your currency in Settings → Budgets.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor={ids.start} className="text-sm font-medium">
                Starts
              </label>
              <input id={ids.start} type="date" value={start} onChange={(event) => setStart(event.target.value)} className={cn(fieldClass, "mt-1 px-2")} />
            </div>
            <div className="min-w-0">
              <label htmlFor={ids.end} className="text-sm font-medium">
                Ends
              </label>
              <input id={ids.end} type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={cn(fieldClass, "mt-1 px-2")} />
            </div>
          </div>
          {tried && error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            List the big costs you know about. This is your first forecast. You can skip it, and for a monthly budget the forecast follows your spending pace
            instead.
          </p>
          <ul className="flex flex-col gap-2" aria-label="Costs you expect">
            {costs.map((cost, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto] items-center gap-2">
                <input
                  aria-label={`Cost ${i + 1}`}
                  value={cost.name}
                  placeholder={COST_IDEAS[i] ?? "Cost"}
                  onChange={(event) => setCosts(costs.map((c, j) => (j === i ? { ...c, name: event.target.value } : c)))}
                  className={fieldClass}
                />
                <input
                  aria-label={`Amount ${i + 1}`}
                  value={cost.amount}
                  inputMode="decimal"
                  placeholder={`${symbol} 0`}
                  onChange={(event) => setCosts(costs.map((c, j) => (j === i ? { ...c, amount: event.target.value } : c)))}
                  className={cn(fieldClass, "tabular-nums")}
                />
                <IconButton label={`Remove cost ${i + 1}`} className="size-11" onClick={() => setCosts(costs.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="h-11 self-start" onClick={() => setCosts([...costs, { name: "", amount: "" }])}>
            <Plus className="size-4" aria-hidden="true" /> Add a cost
          </Button>
          <div className="flex items-start gap-3 rounded-xl border border-stone-200 px-3 py-3 dark:border-stone-800">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Use these as categories</p>
              <p id={ids.categories} className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">
                Each cost becomes a category with its amount as its share of the budget. You can change the shares later.
              </p>
            </div>
            <Switch label="Use these as categories" describedBy={ids.categories} checked={asCategories} onCheckedChange={setAsCategories} />
          </div>
          <div className="mt-2">
            <p className="mb-2 text-sm font-medium">Allowance for surprises</p>
            <SurpriseChoice value={percent} onChange={setPercent} />
            <p className="mt-2 text-[13px] text-stone-500 dark:text-stone-400">Added on top of what you list, because real costs usually come in higher than quotes.</p>
          </div>
          <p
            aria-live="polite"
            className={cn(
              "rounded-xl px-3 py-2.5 text-sm",
              !firstForecast
                ? "bg-stone-100 dark:bg-stone-800"
                : firstForecast > (budget ?? 0)
                  ? "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200"
                  : "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
            )}
          >
            {firstForecast ? (
              <>
                Forecast <span className="font-semibold tabular-nums">{money(firstForecast)}</span>
                {percent ? ` (with ${money(allowance)}, ${percent}%, for surprises)` : ""} of {money(budget ?? 0)}:{" "}
                {firstForecast > (budget ?? 0) ? (
                  <span className="font-semibold">{money(firstForecast - (budget ?? 0))} over before you start.</span>
                ) : (
                  `${money((budget ?? 0) - firstForecast)} left for anything unexpected.`
                )}
              </>
            ) : (
              `Budget ${money(budget ?? 0)}. Nothing listed yet.`
            )}
          </p>
        </div>
      )}
    </BottomSheet>
  );
}

