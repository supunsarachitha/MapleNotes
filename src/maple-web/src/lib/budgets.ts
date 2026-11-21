import { dayKey, dayNumber } from "./dayKeys";
import { joinTitle, splitTitle } from "./titles";

// A budget project is a note of kind "Budget". Its text is Markdown that reads well on its own (and so in exports):
//
//   # Kitchen renovation
//
//   budget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 10%
//
//   ## Categories
//   - Materials: 230000
//
//   ## Spent
//   - 2026-11-14 · Materials · 86400 · Floor tiles, 24 boxes
//     Lanka Tiles, Nugegoda. Two extra boxes for cuts.
//     receipt: 0193a8f2-…
//
//   ## Expected
//   - 2026-12-02 · Materials · 38000 · Countertop
//     id: k3x9q2
//
// An expected cost that is paid in parts gets an indented `id:` (made when first needed), and each payment towards it
// an indented `towards:` with that id. Only those exact lines count; anything else indented stays part of the details.
//
// Amounts are written in the account's currency with up to two decimals and held here as whole hundredths, so sums
// never pick up rounding errors. Dates are calendar days (`yyyy-MM-dd`), counted with day numbers like habits, so no
// time zone or daylight-saving change can shift them. Lines this file does not understand are kept as they are.

/** One cost: a payment already made (spent) or one still to come (expected). */
export interface BudgetLine {
  /** The day it was paid, or the day it is due. */
  date: string;
  category: string;
  /** In hundredths of the currency unit. */
  amount: number;
  /** What it was for. */
  title: string;
  /** Longer details, any number of lines; empty for none. */
  details: string;
  /** The attachment holding its receipt or quote photo, if any. */
  receipt?: string;
  /** Expected costs only: a short id (6 lowercase base36 characters) that payments made towards it point at. */
  id?: string;
  /** Spent costs only: the id of the expected cost this payment was made towards. */
  towards?: string;
}

export interface BudgetCategory {
  name: string;
  /** Its share of the budget, in hundredths. */
  amount: number;
}

export interface Budget {
  name: string;
  /** The budget, in hundredths. */
  budget: number;
  start: string;
  end: string;
  /** The allowance for surprises: a percentage (0 to 100) of what is still expected. */
  surprisePercent: number;
  categories: BudgetCategory[];
  spent: BudgetLine[];
  expected: BudgetLine[];
  /** Any other text in the note, kept as it was. */
  notes: string;
}

export type ForecastMethod = "plan" | "pace";
export type ForecastStatus = "ok" | "tight" | "over";

export interface CategoryForecast {
  name: string;
  budget: number;
  spent: number;
  expected: number;
  forecast: number;
}

export interface Forecast {
  method: ForecastMethod;
  spent: number;
  expected: number;
  /** The allowance for surprises included in `total` (plan forecasts that have not ended only). */
  allowance: number;
  /** The forecast final cost. */
  total: number;
  /** `total` minus the budget: above 0 means over budget. */
  difference: number;
  status: ForecastStatus;
  /**
   * When the money runs out: "already" (spent is over the budget), a date (the expected cost that crosses it, or the
   * day the pace reaches it), "allowance" (listed costs fit but the allowance does not), or null (it does not).
   */
  runsOut: "already" | "allowance" | string | null;
  /** Days in the project and days gone, today included (0 before it starts). */
  days: number;
  daysGone: number;
  /** For pace forecasts that are over: what can still be spent each remaining day to finish on budget. */
  dailyLimit: number | null;
  categories: CategoryForecast[];
  /** The category forecast to overrun its share the most, if any does (categories without a share never do). */
  worstCategory: CategoryForecast | null;
  /** Expected costs whose date has passed. */
  pastDue: BudgetLine[];
}

export const SURPRISE_CHOICES = [0, 5, 10, 15, 20, 25] as const;
const SEP = " · ";
const HEADER = /^budget:\s*(.+)$/i;
const SECTION = /^##\s+(categories|spent|expected)\s*$/i;
const ITEM = /^\s*[-*+]\s+(.*)$/;
const RECEIPT = /^receipt:\s*([0-9a-f-]{36})\s*$/i;
const LINE_ID = /^id: ([0-9a-z]{6})$/;
const TOWARDS = /^towards: ([0-9a-z]{6})$/;
const AMOUNT = /^-?\d+(?:\.\d{1,2})?$/;

/** An amount typed or written as text ("86,400", "12.5") in hundredths, or null if it is not one. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "");
  if (!AMOUNT.test(clean)) return null;
  const [whole, fraction = ""] = clean.replace("-", "").split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return null;
  return clean.startsWith("-") ? -value : value;
}

/** Hundredths written back as plain text: "86400", "12.50". */
export function amountText(hundredths: number): string {
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(Math.round(hundredths));
  const cents = abs % 100;
  return `${sign}${Math.floor(abs / 100)}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}

const clean = (text: string) => text.replace(/\s+/g, " ").replace(/·/g, "-").trim();
const validDay = (text: string | undefined) => (text && dayNumber(text.trim()) !== null ? text.trim() : null);

function parseHeader(text: string): Partial<Pick<Budget, "budget" | "start" | "end" | "surprisePercent">> | null {
  const parts = text.split("·").map((p) => p.trim());
  const budget = parseAmount(parts[0] ?? "");
  if (budget === null || budget < 0) return null;
  const result: Partial<Pick<Budget, "budget" | "start" | "end" | "surprisePercent">> = { budget };
  for (const part of parts.slice(1)) {
    const range = /^(\S+)\s*(?:→|->)\s*(\S+)$/.exec(part);
    const surprises = /^surprises:\s*(\d{1,3})\s*%$/i.exec(part);
    if (range && validDay(range[1]) && validDay(range[2])) Object.assign(result, { start: range[1], end: range[2] });
    else if (surprises && Number(surprises[1]) <= 100) result.surprisePercent = Number(surprises[1]);
    else return null;
  }
  return result;
}

function parseLine(text: string): BudgetLine | null {
  const [date, category, amount, ...title] = text.split("·").map((p) => p.trim());
  const day = validDay(date);
  const value = parseAmount(amount ?? "");
  if (!day || !category || value === null || value < 0) return null;
  return { date: day, category, amount: value, title: title.join(" - ").trim(), details: "" };
}

/** The fallback dates of a project read from a note without a valid header. */
export interface BudgetDefaults {
  today: string;
  surprisePercent: number;
}

/** Reads a project from its note's text. */
export function parseBudget(content: string, defaults: BudgetDefaults): Budget {
  const { title, body } = splitTitle(content);
  const budget: Budget = {
    name: title,
    budget: 0,
    start: defaults.today,
    end: defaults.today,
    surprisePercent: defaults.surprisePercent,
    categories: [],
    spent: [],
    expected: [],
    notes: "",
  };
  const other: string[] = [];
  let section: "categories" | "spent" | "expected" | null = null;
  let headerSeen = false;
  let last: BudgetLine | null = null;
  const lines = body.split(/\r?\n/);
  lines.forEach((line, i) => {
    const heading = SECTION.exec(line.trim());
    if (heading) {
      section = heading[1]!.toLowerCase() as typeof section;
      last = null;
      return;
    }
    // Indented lines under a cost are its details (and its receipt).
    if (last && /^\s{2,}\S/.test(line)) {
      const receipt = RECEIPT.exec(line.trim());
      const id = section === "expected" ? LINE_ID.exec(line.trim()) : null;
      const towards = section === "spent" ? TOWARDS.exec(line.trim()) : null;
      if (receipt && !last.receipt) last.receipt = receipt[1]!.toLowerCase();
      else if (id && !last.id) last.id = id[1];
      else if (towards && !last.towards) last.towards = towards[1];
      else last.details = last.details ? `${last.details}\n${line.replace(/^\s{2}/, "")}` : line.replace(/^\s{2}/, "");
      return;
    }
    // A blank line inside the details: the cost's text goes on when the next line is indented again.
    if (last && /^\s*$/.test(line) && /^\s{2,}\S/.test(lines[i + 1] ?? "")) {
      last.details += "\n";
      return;
    }
    last = null;
    const header = !headerSeen && !section ? HEADER.exec(line.trim()) : null;
    const parsedHeader = header ? parseHeader(header[1]!) : null;
    if (parsedHeader) {
      Object.assign(budget, parsedHeader);
      headerSeen = true;
      return;
    }
    const item = section ? ITEM.exec(line)?.[1] : undefined;
    if (item !== undefined && section === "categories") {
      const match = /^(.+?):\s*(\S+)$/.exec(item.trim());
      const amount = match ? parseAmount(match[2]!) : null;
      if (match && amount !== null && amount >= 0) {
        budget.categories.push({ name: match[1]!.trim(), amount });
        return;
      }
    } else if (item !== undefined && section) {
      const cost = parseLine(item);
      if (cost) {
        (section === "spent" ? budget.spent : budget.expected).push(cost);
        last = cost;
        return;
      }
    }
    other.push(line);
  });
  for (const cost of [...budget.spent, ...budget.expected]) cost.details = cost.details.replace(/\s+$/, "");
  if (dayNumber(budget.end)! < dayNumber(budget.start)!) budget.end = budget.start;
  budget.notes = other.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return budget;
}

function lineText(cost: BudgetLine): string {
  const head = `- ${cost.date}${SEP}${clean(cost.category) || "Other"}${SEP}${amountText(cost.amount)}${cost.title.trim() ? SEP + clean(cost.title) : ""}`;
  const details = cost.details.replace(/\s+$/, "");
  const extra = [
    ...(details ? details.split(/\r?\n/).map((l) => (l.trim() ? `  ${l.replace(/\s+$/, "")}` : "")) : []),
    ...(cost.receipt ? [`  receipt: ${cost.receipt}`] : []),
    ...(cost.id ? [`  id: ${cost.id}`] : []),
    ...(cost.towards ? [`  towards: ${cost.towards}`] : []),
  ];
  return [head, ...extra].join("\n");
}

const byDate = (a: BudgetLine, b: BudgetLine) => a.date.localeCompare(b.date);

/** Writes a project as Markdown. Costs are written oldest first; a project always has a name. */
export function serializeBudget(budget: Budget): string {
  const header = `budget: ${amountText(budget.budget)}${SEP}${budget.start} → ${budget.end}${SEP}surprises: ${budget.surprisePercent}%`;
  const parts = [header];
  if (budget.notes.trim()) parts.push(budget.notes.trim());
  if (budget.categories.length)
    parts.push(["## Categories", ...budget.categories.map((c) => `- ${clean(c.name) || "Other"}: ${amountText(c.amount)}`)].join("\n"));
  if (budget.spent.length) parts.push(["## Spent", ...[...budget.spent].sort(byDate).map(lineText)].join("\n"));
  if (budget.expected.length) parts.push(["## Expected", ...[...budget.expected].sort(byDate).map(lineText)].join("\n"));
  return joinTitle(clean(budget.name) || "Untitled project", parts.join("\n\n"));
}

const total = (costs: BudgetLine[]) => costs.reduce((sum, c) => sum + c.amount, 0);
const percentOf = (amount: number, percent: number) => Math.round((amount * percent) / 100);

/** How far an expected cost has been paid: the estimate, what's been paid towards it, what's left and how much over. */
export interface Progress {
  estimate: number;
  paid: number;
  /** The estimate minus what's been paid, never below 0. This is what the forecast still counts. */
  left: number;
  /** What's been paid beyond the estimate, 0 when it has not been. */
  over: number;
  /** The payments made towards it, oldest first, with their places in `budget.spent`. */
  payments: Array<{ line: BudgetLine; index: number }>;
}

/** The payments towards an expected cost and what is left of it. Costs without an id have no payments. */
export function progressOf(budget: Budget, line: BudgetLine): Progress {
  const payments = line.id
    ? budget.spent.map((payment, index) => ({ line: payment, index })).filter((p) => p.line.towards === line.id).sort((a, b) => a.line.date.localeCompare(b.line.date))
    : [];
  const paid = payments.reduce((sum, p) => sum + p.line.amount, 0);
  return { estimate: line.amount, paid, left: Math.max(0, line.amount - paid), over: Math.max(0, paid - line.amount), payments };
}

/** The expected costs with each amount cut to what's left of it: what the forecast still counts. */
export function stillExpected(budget: Budget): BudgetLine[] {
  return budget.expected.map((line) => ({ ...line, amount: progressOf(budget, line).left }));
}

/** The expected cost a payment was made towards, if it is still listed. */
export function towardsOf(budget: Budget, payment: BudgetLine): BudgetLine | undefined {
  return payment.towards ? budget.expected.find((line) => line.id === payment.towards) : undefined;
}

/** A new short id (6 lowercase base36 characters) that no cost in the project uses yet. */
export function newCostId(budget: Budget, random: () => number = Math.random): string {
  const taken = new Set([...budget.expected.map((c) => c.id), ...budget.spent.map((c) => c.towards)]);
  for (;;) {
    const id = Array.from({ length: 6 }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 36)]).join("");
    if (!taken.has(id)) return id;
  }
}

/** The payments towards an id no longer point at it (its expected cost is gone). */
const unlink = (spent: BudgetLine[], id: string | undefined) =>
  id ? spent.map((line) => (line.towards === id ? (({ towards: _, ...rest }) => rest)(line) : line)) : spent;

/**
 * A payment of part of an expected cost: a spent line in its category, with its title, linked to it by `towards`. The
 * expected cost stays (with an id, made now if it had none), and only what's left of it counts in the forecast.
 */
export function payPart(
  budget: Budget,
  index: number,
  payment: Pick<BudgetLine, "amount" | "date"> & Partial<Pick<BudgetLine, "details" | "receipt">>,
  random: () => number = Math.random,
): Budget {
  const cost = budget.expected[index];
  if (!cost) return budget;
  const id = cost.id ?? newCostId(budget, random);
  const line: BudgetLine = {
    date: payment.date,
    category: cost.category,
    amount: payment.amount,
    title: cost.title,
    details: payment.details ?? "",
    ...(payment.receipt ? { receipt: payment.receipt } : {}),
    towards: id,
  };
  return { ...budget, expected: budget.expected.map((c, i) => (i === index ? { ...c, id } : c)), spent: [...budget.spent, line] };
}

/**
 * Done: an expected cost closed without paying the rest. Its line is removed, so what was left drops out of the
 * forecast; the payments towards it stay as spent and lose their `towards`.
 */
export function finishExpected(budget: Budget, index: number): Budget {
  const cost = budget.expected[index];
  if (!cost) return budget;
  return { ...budget, expected: budget.expected.filter((_, i) => i !== index), spent: unlink(budget.spent, cost.id) };
}

/**
 * Deleting a cost. A deleted payment's amount goes back into what's left of the cost it was towards; a deleted expected
 * cost leaves its payments as ordinary spent lines.
 */
export function removeCost(budget: Budget, kind: "spent" | "expected", index: number): Budget {
  if (kind === "expected") return finishExpected(budget, index);
  return { ...budget, spent: budget.spent.filter((_, i) => i !== index) };
}

/** The forecast of a project's final cost, as of `today`. */
export function forecast(budget: Budget, today: string): Forecast {
  const start = dayNumber(budget.start)!;
  const end = dayNumber(budget.end)!;
  const now = dayNumber(today)!;
  const days = end - start + 1;
  const daysGone = Math.max(0, Math.min(days, now - start + 1));
  const ended = now > end;
  const spent = total(budget.spent);
  // Each expected cost counts only what's left of it once the payments towards it are taken off.
  const left = stillExpected(budget);
  const expected = total(left);

  // A plan when costs are listed (or the project is over); otherwise the pace so far, carried on to the end date.
  const method: ForecastMethod = budget.expected.length > 0 || ended || daysGone === 0 ? "plan" : "pace";
  const allowance = method === "plan" && !ended ? percentOf(expected, budget.surprisePercent) : 0;
  // A pace is an estimate, so it is rounded to whole units of the currency rather than showing made-up cents.
  const paced = (amount: number) => Math.round((amount / daysGone) * days / 100) * 100;
  const final = method === "plan" ? spent + expected + allowance : paced(spent);
  const difference = final - budget.budget;
  const status: ForecastStatus =
    difference > 0 ? "over" : difference > -Math.round(budget.budget * 0.05) ? "tight" : "ok";

  let runsOut: Forecast["runsOut"] = null;
  if (final > budget.budget) {
    if (spent > budget.budget) runsOut = "already";
    else if (method === "plan") {
      let running = spent;
      for (const cost of [...left].sort(byDate)) {
        running += cost.amount;
        if (running > budget.budget) {
          runsOut = cost.date;
          break;
        }
      }
      runsOut ??= "allowance";
    } else {
      const perDay = spent / daysGone;
      runsOut = dayKey(now + Math.max(1, Math.ceil((budget.budget - spent) / perDay)));
    }
  }
  const dailyLimit =
    method === "pace" && difference > 0 ? Math.max(0, Math.floor((budget.budget - spent) / Math.max(1, days - daysGone) / 100) * 100) : null;

  const names = [...budget.categories.map((c) => c.name)];
  for (const cost of [...budget.spent, ...budget.expected]) if (!names.includes(cost.category)) names.push(cost.category);
  const categories = names.map((name): CategoryForecast => {
    const share = budget.categories.find((c) => c.name === name)?.amount ?? 0;
    const s = total(budget.spent.filter((c) => c.category === name));
    const x = total(left.filter((c) => c.category === name));
    const f = method === "plan" ? s + x + (allowance ? percentOf(x, budget.surprisePercent) : 0) : paced(s);
    return { name, budget: share, spent: s, expected: x, forecast: f };
  });
  const worstCategory =
    // Only categories with a share of the budget can overrun it; the others are just a way of grouping costs.
    categories.filter((c) => c.budget > 0 && c.forecast > c.budget).sort((a, b) => b.forecast - b.budget - (a.forecast - a.budget))[0] ?? null;
  // A cost is past due only while something is left to pay on it.
  const pastDue = budget.expected.filter((c, i) => dayNumber(c.date)! < now && left[i]!.amount > 0).sort(byDate);

  return {
    method, spent, expected, allowance, total: final, difference, status, runsOut, days, daysGone, dailyLimit,
    categories, worstCategory, pastDue,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Categories with one row per name: names that differ only in case or spaces become one, with their amounts added up,
 * under the first spelling. Rows without a name are dropped.
 */
export function mergeCategories(items: BudgetCategory[]): BudgetCategory[] {
  const merged: BudgetCategory[] = [];
  for (const item of items) {
    const name = clean(item.name);
    if (!name) continue;
    const found = merged.find((c) => sameName(c.name, name));
    if (found) found.amount += item.amount;
    else merged.push({ name, amount: item.amount });
  }
  return merged;
}

/** A row of the shares form: the category it was (none for a new row), its name now, and its share in hundredths. */
export interface ShareRow {
  from?: string;
  name: string;
  amount: number;
}

/**
 * The project with the shares form saved. A renamed row renames its category on every spent and expected cost too; a
 * category left out only loses its share (its costs keep it). A row with no share is kept only when it already was a
 * category with a share, and rows with the same name become one. A row whose name was cleared keeps its old name.
 */
export function applyShares(budget: Budget, rows: ShareRow[]): Budget {
  const wasShare = (name: string | undefined) => name !== undefined && budget.categories.some((c) => c.name === name);
  const named = rows.map((row) => ({ ...row, name: clean(row.name) || row.from || "" }));
  const categories = mergeCategories(named.filter((row) => row.name && (row.amount > 0 || wasShare(row.from))));
  const spelling = (name: string) => categories.find((c) => sameName(c.name, name))?.name ?? name;
  // All renames are made in one pass, so swapping two names works.
  const renames = new Map<string, string>();
  for (const row of named) if (row.from !== undefined && row.name && spelling(row.name) !== row.from) renames.set(row.from, spelling(row.name));
  const move = (line: BudgetLine) => (renames.has(line.category) ? { ...line, category: renames.get(line.category)! } : line);
  return { ...budget, categories, spent: budget.spent.map(move), expected: budget.expected.map(move) };
}

/**
 * A budget split evenly over `count` rows, in hundredths: whole units of the currency each, with what is left over
 * (the remainder and any cents) on the last row, so the rows always add up to the budget.
 */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const each = Math.floor(total / count / 100) * 100;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - each * (count - 1) : each));
}

/** How shares add up against the budget: some still to assign (`left` above 0), too much (below 0), or all of it. */
export function shareTotals(budget: number, amounts: number[]): { assigned: number; left: number; state: "left" | "over" | "done" } {
  const assigned = amounts.reduce((sum, amount) => sum + amount, 0);
  const left = budget - assigned;
  return { assigned, left, state: left > 0 ? "left" : left < 0 ? "over" : "done" };
}

/**
 * Turns an expected cost into a payment of the real amount on a day; its details and category carry over. On a partly
 * paid cost this pays the rest and closes it: the earlier payments stay as spent and lose their `towards`.
 */
export function markPaid(budget: Budget, index: number, paid: Partial<BudgetLine> & { amount: number; date: string }): Budget {
  const cost = budget.expected[index];
  if (!cost) return budget;
  // The payment is not towards anything: the cost it paid off is gone.
  const { id: _id, towards: _towards, ...rest } = { ...cost, ...paid };
  return {
    ...budget,
    expected: budget.expected.filter((_, i) => i !== index),
    spent: [...unlink(budget.spent, cost.id), rest],
  };
}

/** What the Paid sheet starts with: the estimate, or what's left once part of it has been paid. */
export const amountToPay = (budget: Budget, line: BudgetLine) => {
  const progress = progressOf(budget, line);
  return progress.paid > 0 ? progress.left : line.amount;
};

/** A currency for a browser region when the account has none yet, e.g. "en-LK" gives LKR; USD otherwise. */
export function suggestCurrency(languages: readonly string[]): string {
  const REGION_CURRENCY: Record<string, string> = {
    LK: "LKR", US: "USD", GB: "GBP", IN: "INR", AU: "AUD", CA: "CAD", NZ: "NZD", JP: "JPY", CN: "CNY", SG: "SGD",
    AE: "AED", ZA: "ZAR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", BR: "BRL", MX: "MXN", PK: "PKR",
    BD: "BDT", NP: "NPR", MV: "MVR", MY: "MYR", TH: "THB", ID: "IDR", PH: "PHP", KR: "KRW", SA: "SAR", QA: "QAR",
    KW: "KWD", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR", PT: "EUR",
    FI: "EUR", GR: "EUR",
  };
  for (const language of languages) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(language).maximize().region;
    } catch {
      continue;
    }
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region]!;
  }
  return "USD";
}

/** The currencies offered first in the currency picker. */
export const SUGGESTED_CURRENCIES = ["LKR", "USD", "EUR", "GBP", "INR", "AUD"] as const;

/** The account's currency: the one chosen in Settings, or a guess from the browser's languages until one is. */
export function accountCurrency(chosen: string, languages: readonly string[]): string {
  return chosen || suggestCurrency(languages);
}

const moneyFormats = new Map<string, Intl.NumberFormat>();
const shortMoneyFormats = new Map<string, Intl.NumberFormat | null>();

/** An amount in hundredths as short money for chart labels, e.g. "Rs 450K"; a plain number for an unknown currency. */
export function shortMoney(hundredths: number, currency: string): string {
  let format = shortMoneyFormats.get(currency);
  if (format === undefined) {
    try {
      format = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1 });
    } catch {
      format = null;
    }
    shortMoneyFormats.set(currency, format);
  }
  return format ? format.format(hundredths / 100) : String(Math.round(hundredths / 100));
}

function moneyFormat(currency: string, decimals: boolean, locale?: string): Intl.NumberFormat {
  const key = `${locale ?? ""} ${currency} ${decimals}`;
  let format = moneyFormats.get(key);
  if (!format) {
    const digits = decimals ? 2 : 0;
    const options: Intl.NumberFormatOptions = {
      style: "currency",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    };
    try {
      format = new Intl.NumberFormat(locale, { ...options, currency });
    } catch {
      // A code this browser does not know: show it as the code itself rather than fail.
      format = new Intl.NumberFormat(locale, { ...options, currency: "XXX", currencyDisplay: "code" });
    }
    moneyFormats.set(key, format);
  }
  return format;
}

/**
 * An amount in hundredths as money, e.g. "Rs 86,400" or "$12.50". Whole amounts show no decimals, which keeps the
 * forecast numbers short on a phone; amounts with cents show both decimals.
 */
export function formatMoney(hundredths: number, currency: string, locale?: string): string {
  const rounded = Math.round(hundredths);
  return moneyFormat(currency, rounded % 100 !== 0, locale).format(rounded / 100);
}

/** A currency's name in the user's language, e.g. "Sri Lankan Rupee"; the code if the browser has no name for it. */
export function currencyName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A currency's short symbol, e.g. "Rs", "$", "€"; the code when it has none. */
export function currencySymbol(code: string, locale?: string): string {
  return moneyFormat(code, false, locale).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
}

/** Every currency code this browser knows, for the picker. */
export function allCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return [...SUGGESTED_CURRENCIES];
  }
}

/**
 * The picker's rows for a search: the suggested currencies that match, then the others sorted by name. A query matches
 * a code, a name or exactly a symbol, so "rupee", "lkr" and "rs" all find the Sri Lankan rupee.
 */
export function searchCurrencies(query: string, codes: readonly string[], locale?: string): { suggested: string[]; others: string[] } {
  const q = query.trim().toLowerCase();
  const hit = (code: string) =>
    !q || code.toLowerCase().includes(q) || currencyName(code, locale).toLowerCase().includes(q) || currencySymbol(code, locale).toLowerCase() === q;
  const suggested = SUGGESTED_CURRENCIES.filter((code) => codes.includes(code) && hit(code));
  const others = codes
    .filter((code) => !(SUGGESTED_CURRENCIES as readonly string[]).includes(code) && hit(code))
    .sort((a, b) => currencyName(a, locale).localeCompare(currencyName(b, locale)));
  return { suggested, others };
}

/** Whether a project is finished: its end date has passed. */
export const isFinished = (budget: Budget, today: string) => dayNumber(budget.end)! < dayNumber(today)!;
