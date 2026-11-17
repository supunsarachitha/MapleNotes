import { CalendarClock, Check, Divide, Paperclip, Plus, TrendingUp, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import {
  applyShares,
  forecast,
  markPaid,
  parseAmount,
  amountText,
  shareTotals,
  splitEvenly,
  type Budget,
  type BudgetLine,
  type Forecast,
} from "../lib/budgets";
import { addDays, dateOf, dayNumber } from "../lib/habits";
import { useAttachmentSrc } from "../lib/mediaWorker";
import type { Attachment } from "../lib/types";
import { BottomSheet } from "./BottomSheet";
import { Button, IconButton, Spinner, cn } from "./ui";

const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** A calendar day (yyyy-MM-dd) as "Dec 2". */
export const dayText = (key: string) => shortDay.format(dateOf(key));
/** A calendar day as "Mon, Dec 2". */
export const weekdayText = (key: string) => longDay.format(dateOf(key));

export const fieldClass =
  "h-11 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900";

export const chipClass = (selected: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-4 text-base transition-colors focus-visible:outline-2 focus-visible:outline-maple-500",
    selected
      ? "border-maple-600 bg-maple-50 font-medium text-maple-700 dark:border-maple-500 dark:bg-maple-600/15 dark:text-maple-400"
      : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800",
  );

/** An amount field: the currency symbol, then a large number typed with the phone's number pad. */
export function AmountField({
  id,
  symbol,
  value,
  onChange,
  autoFocus,
  describedBy,
}: {
  id: string;
  symbol: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="mt-1 flex items-center rounded-xl border border-stone-300 bg-white focus-within:border-maple-500 dark:border-stone-700 dark:bg-stone-900">
      <span className="pl-3 font-semibold text-stone-500 dark:text-stone-400" aria-hidden="true">
        {symbol}
      </span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        enterKeyHint="done"
        placeholder="0"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-describedby={describedBy}
        className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-xl font-semibold tabular-nums outline-none"
      />
    </div>
  );
}

/** What a change does to the forecast, in one sentence: "Forecast goes up Rs 5,000 to Rs 455,100, Rs 5,100 over budget." */
export function ForecastEffect({ before, after, money, children }: { before: Forecast; after: Forecast; money: (n: number) => string; children?: ReactNode }) {
  const change = after.total - before.total;
  const over = after.difference > 0;
  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-xl px-3 py-2.5 text-sm",
        over ? "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
      )}
    >
      Forecast {change > 0 ? `goes up ${money(change)} to` : change < 0 ? `goes down ${money(-change)} to` : "stays at"}{" "}
      <span className="font-semibold tabular-nums">{money(after.total)}</span>,{" "}
      {over ? <span className="font-semibold">{money(after.difference)} over</span> : `${money(-after.difference)} under`} budget.
      {children}
    </div>
  );
}

/** Which form the cost sheet shows: a new cost, a change to one, or paying an expected one. */
export type CostMode = { kind: "spent" | "expected"; edit?: number; pay?: number };

/** The names of a project's categories: its shares first, then any other used by a cost. */
export function categoryNames(budget: Budget): string[] {
  const names = budget.categories.map((c) => c.name);
  for (const cost of [...budget.spent, ...budget.expected]) if (!names.includes(cost.category)) names.push(cost.category);
  return names;
}

/** The project after the sheet's change, with `amount` in hundredths. */
function applyCost(budget: Budget, mode: CostMode, line: BudgetLine): Budget {
  if (mode.pay !== undefined) return markPaid(budget, mode.pay, line);
  const list = [...budget[mode.kind]];
  if (mode.edit !== undefined) list[mode.edit] = line;
  else list.push(line);
  return { ...budget, [mode.kind]: list };
}

/**
 * Adding or editing a cost, or marking an expected one paid with what it really cost. The amount comes first (with the
 * number pad), and the forecast's change shows live under it. A receipt or quote photo is uploaded as soon as it is
 * picked; `onDiscard` gets uploads the save did not keep, so they can be deleted.
 */
export function CostSheet({
  budget,
  mode,
  today,
  money,
  symbol,
  onClose,
  onSave,
  onUpload,
  onDiscard,
}: {
  budget: Budget;
  mode: CostMode;
  today: string;
  money: (n: number) => string;
  symbol: string;
  onClose: () => void;
  onSave: (next: Budget, dropped: string[]) => void;
  onUpload: (file: File) => Promise<Attachment>;
  onDiscard: (ids: string[]) => void;
}) {
  const original = mode.pay !== undefined ? budget.expected[mode.pay] : mode.edit !== undefined ? budget[mode.kind][mode.edit] : undefined;
  const spent = mode.kind === "spent" || mode.pay !== undefined;
  const names = categoryNames(budget);
  const [amount, setAmount] = useState(original ? amountText(original.amount) : "");
  const [title, setTitle] = useState(original?.title ?? "");
  const [details, setDetails] = useState(original?.details ?? "");
  const [category, setCategory] = useState(original?.category ?? names[0] ?? "");
  const [newCategory, setNewCategory] = useState(names.length === 0);
  const [date, setDate] = useState(original && mode.pay === undefined ? original.date : spent ? today : addDays(today, 14));
  const [receipt, setReceipt] = useState(original?.receipt);
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const uploaded = useRef<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const ids = { amount: useId(), title: useId(), details: useId(), category: useId(), date: useId(), error: useId() };

  const value = parseAmount(amount);
  const valid = value !== null && value > 0;
  const cleanCategory = category.trim() || "Other";
  const line: BudgetLine = {
    date: dayNumber(date) === null ? today : date,
    category: cleanCategory,
    amount: valid ? value : 0,
    title: mode.pay !== undefined ? original!.title : title.trim() || cleanCategory,
    details: details.replace(/\s+$/, ""),
    ...(receipt ? { receipt } : {}),
  };
  const before = forecast(budget, today);
  const after = forecast(applyCost(budget, mode, line), today);
  const heading =
    mode.pay !== undefined ? "Mark as paid" : mode.edit !== undefined ? (spent ? "Edit payment" : "Edit expected cost") : spent ? "Add what you spent" : "Add an expected cost";

  function close(saved: boolean) {
    const keep = saved ? receipt : original?.receipt;
    onDiscard(uploaded.current.filter((id) => id !== keep));
    onClose();
  }

  function save() {
    setTried(true);
    if (!valid || uploading) return;
    const dropped = original?.receipt && original.receipt !== receipt ? [original.receipt] : [];
    onSave(applyCost(budget, mode, line), dropped);
    close(true);
  }

  async function pick(chosen: File | undefined) {
    if (!chosen) return;
    setUploading(true);
    try {
      const added = await onUpload(chosen);
      uploaded.current.push(added.id);
      setReceipt(added.id);
    } catch {
      // onUpload tells the user; the cost keeps the photo it had.
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && close(false)}
      title={heading}
      footer={
        <>
          <Button variant="ghost" className="h-11 flex-1" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={save} disabled={uploading}>
            {mode.pay !== undefined ? "Mark paid" : "Save"}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-4 pt-1"
      >
        {mode.pay !== undefined && original && (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            {original.title} was expected to cost {money(original.amount)}. Enter what you actually paid.
          </p>
        )}
        <div>
          <label htmlFor={ids.amount} className="text-sm font-medium">
            {spent ? "How much?" : "About how much?"}
          </label>
          <AmountField id={ids.amount} symbol={symbol} value={amount} onChange={setAmount} autoFocus={mode.edit === undefined} describedBy={tried && !valid ? ids.error : undefined} />
          {tried && !valid && (
            <p id={ids.error} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
              Enter the amount, e.g. 12,500.
            </p>
          )}
          <div className="mt-2">
            {valid ? (
              <ForecastEffect before={before} after={after} money={money}>
                {spent && mode.pay === undefined && mode.edit === undefined && before.method === "plan" && budget.expected.length > 0 && (
                  <span className="mt-1 block text-[13px] opacity-90">
                    If this was one of your expected costs, use <span className="font-semibold">Paid</span> on it instead, so it isn't counted twice.
                  </span>
                )}
              </ForecastEffect>
            ) : (
              <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-sm dark:bg-stone-800">
                Forecast now: <span className="font-semibold tabular-nums">{money(before.total)}</span> of {money(budget.budget)}.
              </p>
            )}
          </div>
        </div>
        {mode.pay === undefined && (
          <div>
            <label htmlFor={ids.title} className="text-sm font-medium">
              What for?
            </label>
            <input
              id={ids.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={spent ? "e.g. Floor tiles" : "e.g. Countertop"}
              enterKeyHint="next"
              maxLength={200}
              autoComplete="off"
              className={cn(fieldClass, "mt-1")}
            />
          </div>
        )}
        <div>
          <label htmlFor={ids.details} className="text-sm font-medium">
            Details <span className="font-normal text-stone-500 dark:text-stone-400">(optional)</span>
          </label>
          <textarea
            id={ids.details}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            placeholder={spent ? "Shop, what exactly you got, warranty, who you paid…" : "Quote, who it's from, what's included, phone number…"}
            className="mt-1 block min-h-24 w-full resize-y rounded-xl border border-stone-300 bg-white px-3 py-2 text-base outline-none [field-sizing:content] focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900"
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Category</legend>
          {names.length > 0 && (
            <div className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={!newCategory && category === name}
                  onClick={() => {
                    setNewCategory(false);
                    setCategory(name);
                  }}
                  className={chipClass(!newCategory && category === name)}
                >
                  {name}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={newCategory}
                onClick={() => {
                  setNewCategory(true);
                  setCategory("");
                }}
                className={chipClass(newCategory)}
              >
                <Plus className="size-4" aria-hidden="true" /> New
              </button>
            </div>
          )}
          {newCategory && (
            <input
              aria-label="New category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="e.g. Materials"
              maxLength={60}
              autoComplete="off"
              className={cn(fieldClass, "mt-2")}
            />
          )}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor={ids.date} className="text-sm font-medium">
              {spent ? "Date" : "When?"}
            </label>
            <input id={ids.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} className={cn(fieldClass, "mt-1 px-2")} />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium">{spent ? "Receipt" : "Quote photo"}</span>
            <input ref={file} type="file" accept="image/*,application/pdf" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => void pick(event.target.files?.[0])} />
            {receipt ? (
              <div className="mt-1 flex h-11 items-center gap-1 rounded-xl border border-emerald-600/40 bg-emerald-50 pl-3 text-sm font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Check className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Added</span>
                <button
                  type="button"
                  aria-label={spent ? "Remove the receipt" : "Remove the quote photo"}
                  onClick={() => setReceipt(undefined)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-500/15"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Button variant="secondary" className="mt-1 h-11 w-full rounded-xl" disabled={uploading} onClick={() => file.current?.click()}>
                {uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" aria-hidden="true" />}
                {uploading ? "Uploading…" : "Add photo"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </BottomSheet>
  );
}

function ReceiptPreview({ attachment, label, onOpen }: { attachment: Attachment; label: string; onOpen: () => void }) {
  const src = useAttachmentSrc(attachment);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 flex w-full items-center gap-3 rounded-xl border border-stone-200 p-2 text-left hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
    >
      {attachment.isImage && src ? (
        <img src={src} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
          <Paperclip className="size-5" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-sm text-stone-500 dark:text-stone-400">Tap to open</span>
      </span>
    </button>
  );
}

/** One cost in full: amount, state, category, day, details and its photo, with Delete, Edit and (if expected) Paid. */
export function ViewCostSheet({
  line,
  kind,
  today,
  money,
  attachment,
  onClose,
  onDelete,
  onEdit,
  onPay,
  onOpenReceipt,
  readOnly,
}: {
  line: BudgetLine;
  kind: "spent" | "expected";
  today: string;
  money: (n: number) => string;
  attachment?: Attachment;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onPay: () => void;
  onOpenReceipt: () => void;
  readOnly?: boolean;
}) {
  const late = kind === "expected" && line.date < today;
  const tag = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium";
  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={line.title || line.category}
      footer={
        readOnly ? undefined : (
          <>
            <Button variant="ghost" className="h-11 flex-1 text-red-700 dark:text-red-400" onClick={onDelete}>
              Delete
            </Button>
            <Button variant={kind === "expected" ? "secondary" : "primary"} className="h-11 flex-1" onClick={onEdit}>
              Edit
            </Button>
            {kind === "expected" && (
              <Button className="h-11 flex-1" onClick={onPay}>
                Paid
              </Button>
            )}
          </>
        )
      }
    >
      <p className="text-3xl font-bold tabular-nums tracking-tight">{money(line.amount)}</p>
      <div className="mb-4 mt-2 flex flex-wrap gap-1.5">
        <span
          className={cn(
            tag,
            kind === "spent"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
          )}
        >
          {kind === "spent" ? "Paid" : late ? "Expected · past due" : "Expected"}
        </span>
        <span className={cn(tag, "bg-stone-100 dark:bg-stone-800")}>{line.category}</span>
        <span className={cn(tag, "bg-stone-100 dark:bg-stone-800")}>{weekdayText(line.date)}</span>
      </div>
      {line.details ? (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Details</h3>
          <p className="whitespace-pre-wrap break-words text-base">{line.details}</p>
        </>
      ) : (
        <p className="text-sm text-stone-500 dark:text-stone-400">No details.{readOnly ? "" : " Tap Edit to add some."}</p>
      )}
      {line.receipt &&
        (attachment ? (
          <ReceiptPreview attachment={attachment} label={kind === "spent" ? "Receipt" : "Quote"} onOpen={onOpenReceipt} />
        ) : (
          <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">The photo could not be found.</p>
        ))}
    </BottomSheet>
  );
}

/** How the forecast is worked out: a plan when costs are expected, the spending pace otherwise. */
export function MethodSheet({ onClose }: { onClose: () => void }) {
  const row = "flex gap-3 py-3";
  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="How the forecast works"
      footer={
        <Button className="h-11 flex-1" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className={cn(row, "border-b border-stone-200 dark:border-stone-800")}>
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-maple-700 dark:text-maple-400" aria-hidden="true" />
        <p className="text-sm">
          <span className="font-semibold">Your plan</span>: what you've spent plus the costs you've said are still coming. Best for renovations, trips and
          events. It also adds an <span className="font-semibold">allowance for surprises</span>: a percentage of what's still expected that you choose for
          each project (you can turn it off), since real costs usually come in higher than quotes.
        </p>
      </div>
      <div className={row}>
        <TrendingUp className="mt-0.5 size-5 shrink-0 text-maple-700 dark:text-maple-400" aria-hidden="true" />
        <p className="text-sm">
          <span className="font-semibold">Your spending pace</span>: when nothing is listed as expected, the daily average so far is carried on to the end
          date. Best for monthly budgets like groceries.
        </p>
      </div>
    </BottomSheet>
  );
}

/**
 * The live check of shares against the budget: "Not assigned yet: Rs 20,000" (neutral), "Rs 5,000 too much" (red) or
 * "All assigned" (green). It only informs: saving is never blocked by it.
 */
export function ShareTotal({ budget, amounts, money }: { budget: number; amounts: number[]; money: (n: number) => string }) {
  const { left, state } = shareTotals(budget, amounts);
  return (
    <p
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm",
        state === "over"
          ? "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200"
          : state === "done"
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
            : "bg-stone-100 dark:bg-stone-800",
      )}
    >
      {state === "done" && <Check className="size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">
        {state === "left" ? (
          <>
            Not assigned yet: <span className="whitespace-nowrap font-semibold tabular-nums">{money(left)}</span>
          </>
        ) : state === "over" ? (
          <>
            <span className="whitespace-nowrap font-semibold tabular-nums">{money(-left)}</span> too much
          </>
        ) : (
          <span className="font-semibold">All assigned</span>
        )}
      </span>
    </p>
  );
}

/**
 * Each category's share of the budget: one row per category (name, then amount), which can be added, renamed and
 * removed. A rename also renames the category on its costs; removing one only drops its share. Split evenly fills the
 * amounts in, and the total is checked against the budget as you type.
 */
export function SharesSheet({
  budget,
  money,
  symbol,
  onClose,
  onSave,
}: {
  budget: Budget;
  money: (n: number) => string;
  symbol: string;
  onClose: () => void;
  onSave: (next: Budget) => void;
}) {
  const shareOf = (name: string) => budget.categories.find((c) => c.name === name)?.amount ?? 0;
  const [rows, setRows] = useState<Array<{ key: number; from?: string; name: string; amount: string }>>(() =>
    categoryNames(budget).map((name, key) => ({ key, from: name, name, amount: shareOf(name) ? amountText(shareOf(name)) : "" })),
  );
  const nextKey = useRef(rows.length);
  const names = useRef<Array<HTMLInputElement | null>>([]);
  const [tried, setTried] = useState(false);
  const errorId = useId();
  const values = rows.map((row) => (row.amount.trim() ? parseAmount(row.amount) : 0));
  const bad = rows.findIndex((_, i) => values[i] === null || values[i]! < 0);
  const set = (key: number, change: Partial<{ name: string; amount: string }>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function add() {
    setRows((current) => [...current, { key: nextKey.current++, name: "", amount: "" }]);
    requestAnimationFrame(() => names.current.filter(Boolean).at(-1)?.focus());
  }

  function save() {
    setTried(true);
    if (bad >= 0) return;
    onSave(applyShares(budget, rows.map((row, i) => ({ from: row.from, name: row.name, amount: values[i] ?? 0 }))));
    onClose();
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Category shares"
      footer={
        <>
          <Button variant="ghost" className="h-11 flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-3 pt-1"
      >
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Give each category its share of the budget of <span className="whitespace-nowrap font-semibold tabular-nums">{money(budget.budget)}</span>. A new name
          is used on that category's costs too; removing a category keeps its costs.
        </p>
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Categories and their shares">
            {rows.map((row, i) => {
              const label = row.name.trim() || row.from || `category ${i + 1}`;
              return (
                <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto] items-center gap-2">
                  <input
                    ref={(element) => {
                      names.current[i] = element;
                    }}
                    aria-label={`Category ${i + 1}`}
                    value={row.name}
                    placeholder={row.from ?? "e.g. Materials"}
                    maxLength={60}
                    autoComplete="off"
                    enterKeyHint="next"
                    onChange={(event) => set(row.key, { name: event.target.value })}
                    className={fieldClass}
                  />
                  <input
                    aria-label={`Share of ${label}`}
                    value={row.amount}
                    inputMode="decimal"
                    enterKeyHint="done"
                    placeholder={`${symbol} 0`}
                    autoComplete="off"
                    aria-invalid={tried && (values[i] === null || values[i]! < 0) ? true : undefined}
                    aria-describedby={tried && bad === i ? errorId : undefined}
                    onChange={(event) => set(row.key, { amount: event.target.value })}
                    className={cn(fieldClass, "tabular-nums", tried && (values[i] === null || values[i]! < 0) && "border-red-600 dark:border-red-500")}
                  />
                  <IconButton label={`Remove ${label}`} className="size-11" onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}>
                    <X className="size-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-stone-300 px-3 py-4 text-center text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300">
            No categories yet. Add one, such as Materials or Labour.
          </p>
        )}
        {tried && bad >= 0 && (
          <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-400">
            Check the share of {rows[bad]!.name.trim() || rows[bad]!.from || `category ${bad + 1}`}, e.g. 12,500.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="h-11" onClick={add}>
            <Plus className="size-4" aria-hidden="true" /> Add category
          </Button>
          <Button
            variant="secondary"
            className="h-11"
            disabled={rows.length === 0}
            onClick={() => {
              const split = splitEvenly(budget.budget, rows.length);
              setRows((current) => current.map((row, i) => ({ ...row, amount: amountText(split[i] ?? 0) })));
            }}
          >
            <Divide className="size-4" aria-hidden="true" /> Split evenly
          </Button>
        </div>
        <ShareTotal budget={budget.budget} amounts={values.map((v) => v ?? 0)} money={money} />
      </form>
    </BottomSheet>
  );
}

/** Renaming a project, or changing its budget and dates. */
export function ProjectSheet({
  budget,
  symbol,
  focus,
  onClose,
  onSave,
}: {
  budget: Budget;
  symbol: string;
  focus: "name" | "budget";
  onClose: () => void;
  onSave: (next: Budget) => void;
}) {
  const [name, setName] = useState(budget.name);
  const [amount, setAmount] = useState(amountText(budget.budget));
  const [start, setStart] = useState(budget.start);
  const [end, setEnd] = useState(budget.end);
  const [tried, setTried] = useState(false);
  const ids = { name: useId(), amount: useId(), start: useId(), end: useId() };
  const value = parseAmount(amount);
  const error = !name.trim()
    ? "Give the project a name."
    : value === null || value <= 0
      ? "Enter the budget, e.g. 450,000."
      : dayNumber(start) === null || dayNumber(end) === null || end < start
        ? "The end date can't be before the start."
        : null;

  function save() {
    setTried(true);
    if (error || value === null) return;
    onSave({ ...budget, name: name.trim(), budget: value, start, end });
    onClose();
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={focus === "name" ? "Rename project" : "Budget and dates"}
      footer={
        <>
          <Button variant="ghost" className="h-11 flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-4 pt-1"
      >
        <div>
          <label htmlFor={ids.name} className="text-sm font-medium">
            Name
          </label>
          <input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} autoFocus={focus === "name"} maxLength={200} className={cn(fieldClass, "mt-1")} />
        </div>
        <div>
          <label htmlFor={ids.amount} className="text-sm font-medium">
            Budget
          </label>
          <AmountField id={ids.amount} symbol={symbol} value={amount} onChange={setAmount} autoFocus={focus === "budget"} />
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
    </BottomSheet>
  );
}
