import { describe, expect, it } from "vitest";
import {
  accountCurrency,
  allCurrencies,
  amountText,
  currencyName,
  currencySymbol,
  formatMoney,
  isFinished,
  searchCurrencies,
  forecast,
  markPaid,
  parseAmount,
  parseBudget,
  serializeBudget,
  suggestCurrency,
  type Budget,
  type BudgetLine,
} from "./budgets";

const defaults = { today: "2026-11-16", surprisePercent: 10 };
const cost = (date: string, category: string, amount: number, title = "", details = ""): BudgetLine => ({
  date, category, amount: amount * 100, title, details,
});

const KITCHEN = `# Kitchen renovation

budget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 10%

## Categories
- Materials: 230000
- Labour: 160000
- Appliances: 60000

## Spent
- 2026-10-20 · Materials · 70000 · Cabinet wood
- 2026-10-31 · Labour · 35000 · Mason, week 1
- 2026-11-01 · Appliances · 48500 · Gas hob
  Singer 2-burner, glass top.
  receipt: 0193a8f2-0000-7000-8000-000000000001
- 2026-11-03 · Materials · 42000 · Sink and tap set
- 2026-11-07 · Labour · 35000 · Mason, week 2
- 2026-11-12 · Materials · 18500 · Paint and primer
- 2026-11-14 · Materials · 86400 · Floor tiles, 24 boxes
  Lanka Tiles, Nugegoda.

  Two extra boxes for cuts and breakage.
- 2026-11-14 · Labour · 35000 · Mason, week 3

## Expected
- 2026-11-21 · Labour · 35000 · Mason, week 4
- 2026-11-28 · Materials · 30000 · Cabinet doors
- 2026-12-02 · Materials · 38000 · Countertop
- 2026-12-05 · Labour · 25000 · Electrician
- 2026-12-10 · Materials · 12000 · Lights`;

describe("amounts", () => {
  it("reads typed amounts as hundredths and writes them back plainly", () => {
    expect([parseAmount("86400"), parseAmount("86,400"), parseAmount("12.5"), parseAmount("0.05")]).toEqual([8640000, 8640000, 1250, 5]);
    expect([parseAmount(""), parseAmount("12.345"), parseAmount("abc"), parseAmount("1e5")]).toEqual([null, null, null, null]);
    expect([amountText(8640000), amountText(1250), amountText(5), amountText(0)]).toEqual(["86400", "12.50", "0.05", "0"]);
  });

  it("adds up cents without rounding errors", () => {
    const budget = parseBudget("# T\n\nbudget: 1\n\n## Spent\n- 2026-11-01 · Food · 0.10\n- 2026-11-01 · Food · 0.20", defaults);
    expect(forecast(budget, "2026-11-01").spent).toBe(30); // not 30.000000000000004
  });
});

describe("project text", () => {
  it("reads the header, categories, costs, details and receipts", () => {
    const budget = parseBudget(KITCHEN, defaults);
    expect(budget).toMatchObject({ name: "Kitchen renovation", budget: 45000000, start: "2026-10-01", end: "2026-12-20", surprisePercent: 10 });
    expect(budget.categories.map((c) => c.name)).toEqual(["Materials", "Labour", "Appliances"]);
    expect([budget.spent.length, budget.expected.length]).toEqual([8, 5]);
    expect(budget.spent[2]).toEqual({
      date: "2026-11-01", category: "Appliances", amount: 4850000, title: "Gas hob",
      details: "Singer 2-burner, glass top.", receipt: "0193a8f2-0000-7000-8000-000000000001",
    });
    expect(budget.spent[6]!.details).toBe("Lanka Tiles, Nugegoda.\n\nTwo extra boxes for cuts and breakage.");
    expect(budget.notes).toBe("");
  });

  it("writes the same text back", () => {
    expect(serializeBudget(parseBudget(KITCHEN, defaults))).toBe(KITCHEN);
  });

  it("keeps lines it does not understand, and titles that contain the separator", () => {
    const text = "# Trip #travel\n\nFor the long weekend.\n\nbudget: 80000\n\n## Spent\n- 2026-11-02 · Travel · 6400 · Train · Kandy to Ella\n- not a cost line";
    const budget = parseBudget(text, defaults);
    expect(budget.name).toBe("Trip #travel");
    expect(budget.spent[0]!.title).toBe("Train - Kandy to Ella");
    expect(budget.notes).toBe("For the long weekend.\n\n- not a cost line");
    expect(budget).toMatchObject({ start: "2026-11-16", end: "2026-11-16", surprisePercent: 10 }); // defaults
    const again = parseBudget(serializeBudget(budget), defaults);
    expect(again.notes).toBe(budget.notes);
    expect(again.spent).toEqual(budget.spent);
  });

  it("ignores impossible dates, negative amounts and a bad header", () => {
    const budget = parseBudget(
      "# X\n\nbudget: lots · 2026-02-30 → 2026-03-01\n\n## Spent\n- 2026-02-30 · Food · 10\n- 2026-03-01 · Food · -5\n- 2026-03-01 · Food · 5",
      defaults,
    );
    expect(budget.budget).toBe(0);
    expect(budget.spent.map((c) => c.amount)).toEqual([500]);
    expect(budget.notes).toContain("budget: lots");
  });

  it("gives an unnamed project a name and tidies separators out of fields", () => {
    const budget: Budget = {
      name: "  ", budget: 100, start: "2026-11-01", end: "2026-11-30", surprisePercent: 0, categories: [],
      spent: [{ ...cost("2026-11-02", "Food · drink", 1, "A · B"), details: "line one  \n\nline three" }], expected: [], notes: "",
    };
    expect(serializeBudget(budget)).toBe(
      "# Untitled project\n\nbudget: 1 · 2026-11-01 → 2026-11-30 · surprises: 0%\n\n## Spent\n- 2026-11-02 · Food - drink · 1 · A - B\n  line one\n\n  line three",
    );
  });
});

describe("forecast from a plan", () => {
  const kitchen = parseBudget(KITCHEN, defaults);

  it("adds what is still expected and the allowance for surprises", () => {
    const f = forecast(kitchen, "2026-11-16");
    expect(f.method).toBe("plan");
    expect([f.spent, f.expected, f.allowance, f.total]).toEqual([37040000, 14000000, 1400000, 52440000]);
    expect([f.difference, f.status]).toEqual([7440000, "over"]);
    expect(f.runsOut).toBe("2026-12-02"); // the countertop is the cost that crosses the budget
  });

  it("uses each project's own percentage, and none when it is off", () => {
    expect(forecast({ ...kitchen, surprisePercent: 20 }, "2026-11-16").allowance).toBe(2800000);
    expect(forecast({ ...kitchen, surprisePercent: 0 }, "2026-11-16").total).toBe(51040000);
  });

  it("says when only the allowance takes it over", () => {
    const f = forecast({ ...kitchen, budget: 51500000 }, "2026-11-16");
    expect([f.status, f.runsOut]).toEqual(["over", "allowance"]);
  });

  it("is tight within 5% of the budget and on budget below that", () => {
    expect(forecast({ ...kitchen, budget: 53000000 }, "2026-11-16").status).toBe("tight");
    expect(forecast({ ...kitchen, budget: 60000000 }, "2026-11-16").status).toBe("ok");
  });

  it("finds the category that overruns most and the costs past due", () => {
    const f = forecast(kitchen, "2026-11-22");
    expect(f.worstCategory).toMatchObject({ name: "Materials", budget: 23000000, spent: 21690000, expected: 8000000, forecast: 30490000 });
    expect(f.pastDue.map((c) => c.title)).toEqual(["Mason, week 4"]);
  });

  it("stops adding the allowance once the project has ended", () => {
    const f = forecast(kitchen, "2026-12-21");
    expect([f.method, f.allowance, f.total]).toEqual(["plan", 0, 51040000]);
  });

  it("marking a cost paid replaces the estimate with the real amount", () => {
    const paid = markPaid(kitchen, 1, { amount: 3600000, date: "2026-11-16", receipt: "0193a8f2-0000-7000-8000-000000000002" });
    expect(paid.expected.map((c) => c.title)).not.toContain("Cabinet doors");
    expect(paid.spent.at(-1)).toMatchObject({ title: "Cabinet doors", category: "Materials", amount: 3600000, date: "2026-11-16" });
    // +6,000 for the real price, -3,000 because that cost no longer needs its allowance
    expect(forecast(paid, "2026-11-16").total - forecast(kitchen, "2026-11-16").total).toBe(300000);
  });
});

describe("forecast from the pace", () => {
  const groceries = parseBudget(
    `# Groceries\n\nbudget: 60000 · 2026-11-01 → 2026-11-30 · surprises: 10%\n\n## Spent
- 2026-11-02 · Food · 9200\n- 2026-11-05 · Food · 4300\n- 2026-11-09 · Food · 8800\n- 2026-11-09 · Household · 3100
- 2026-11-12 · Food · 5200\n- 2026-11-15 · Food · 7900`,
    defaults,
  );

  it("carries the daily average on to the end date, with no allowance", () => {
    const f = forecast(groceries, "2026-11-16");
    expect([f.method, f.daysGone, f.days, f.spent, f.allowance]).toEqual(["pace", 16, 30, 3850000, 0]);
    expect(f.total).toBe(7218750); // 38,500 / 16 days × 30 days
    expect(f.status).toBe("over");
    expect(f.runsOut).toBe("2026-11-25"); // 21,500 left at 2,406.25 a day: 9 more days
    expect(f.dailyLimit).toBe(153571); // 21,500 over the 14 days left
  });

  it("switches to the plan as soon as a cost is expected", () => {
    const planned = { ...groceries, expected: [cost("2026-11-25", "Food", 8000)] };
    expect(forecast(planned, "2026-11-16")).toMatchObject({ method: "plan", total: 3850000 + 800000 + 80000 });
  });

  it("does not divide by zero before the project starts", () => {
    expect(forecast(groceries, "2026-10-20")).toMatchObject({ method: "plan", daysGone: 0, total: 3850000 });
  });
});

describe("currency suggestion", () => {
  it("follows the browser's region, and falls back to US dollars", () => {
    expect(suggestCurrency(["en-LK"])).toBe("LKR");
    expect(suggestCurrency(["si", "en-GB"])).toBe("LKR"); // Sinhala's likely region is Sri Lanka
    expect(suggestCurrency(["de-DE"])).toBe("EUR");
    expect(suggestCurrency(["xx-invalid-!!"])).toBe("USD");
  });
});

describe("money and currencies", () => {
  it("formats whole amounts without decimals and others with two", () => {
    expect(formatMoney(125000000, "USD", "en-US")).toBe("$1,250,000");
    expect(formatMoney(1250, "USD", "en-US")).toBe("$12.50");
    expect(formatMoney(-40000, "EUR", "en-US")).toBe("-€400");
    expect(formatMoney(8640000, "LKR", "en-US")).toContain("86,400");
  });

  it("names currencies and finds them by code, name or symbol", () => {
    expect(currencyName("LKR", "en")).toBe("Sri Lankan Rupee");
    expect(currencySymbol("EUR", "en-US")).toBe("€");
    const codes = ["USD", "LKR", "EUR", "JPY", "INR", "PKR"];
    expect(searchCurrencies("", codes, "en").suggested).toEqual(["LKR", "USD", "EUR", "INR"]);
    expect(searchCurrencies("", codes, "en").others).toEqual(["JPY", "PKR"]);
    expect(searchCurrencies("rupee", codes, "en")).toEqual({ suggested: ["LKR", "INR"], others: ["PKR"] });
    expect(searchCurrencies("jpy", codes, "en")).toEqual({ suggested: [], others: ["JPY"] });
    expect(searchCurrencies("€", codes, "en").suggested).toEqual(["EUR"]);
  });

  it("uses the chosen currency, or a guess from the browser until one is chosen", () => {
    expect(accountCurrency("EUR", ["en-LK"])).toBe("EUR");
    expect(accountCurrency("", ["en-LK"])).toBe("LKR");
    expect(allCurrencies()).toContain("LKR");
  });

  it("calls a project finished once its end date has passed", () => {
    const budget = parseBudget("# Trip\n\nbudget: 100 · 2026-10-01 → 2026-10-31 · surprises: 10%", { today: "2026-10-05", surprisePercent: 10 });
    expect(isFinished(budget, "2026-10-31")).toBe(false);
    expect(isFinished(budget, "2026-11-01")).toBe(true);
  });
});

describe("categories without a share", () => {
  it("never count as the category that overruns the budget", () => {
    const budget = parseBudget("# Trip\n\nbudget: 1000 · 2026-11-01 → 2026-11-30 · surprises: 0%\n\n## Expected\n- 2026-11-20 · Hotel · 1500 · Hotel", defaults);
    const f = forecast(budget, "2026-11-16");
    expect(f.difference).toBe(50000);
    expect(f.categories).toEqual([{ name: "Hotel", budget: 0, spent: 0, expected: 150000, forecast: 150000 }]);
    expect(f.worstCategory).toBeNull();
  });
});
