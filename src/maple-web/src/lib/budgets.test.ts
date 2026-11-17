import { describe, expect, it } from "vitest";
import {
  accountCurrency,
  allCurrencies,
  amountText,
  applyShares,
  currencyName,
  currencySymbol,
  formatMoney,
  isFinished,
  searchCurrencies,
  forecast,
  amountToPay,
  finishExpected,
  markPaid,
  newCostId,
  payPart,
  progressOf,
  removeCost,
  stillExpected,
  towardsOf,
  mergeCategories,
  parseAmount,
  parseBudget,
  serializeBudget,
  shareTotals,
  splitEvenly,
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
    expect(f.total).toBe(7218800); // 38,500 / 16 days × 30 days = 72,187.50, rounded to whole rupees
    expect(f.status).toBe("over");
    expect(f.runsOut).toBe("2026-11-25"); // 21,500 left at 2,406.25 a day: 9 more days
    expect(f.dailyLimit).toBe(153500); // 21,500 over the 14 days left = 1,535.71, rounded down to whole rupees
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

  it("are passed over for one with a share, even when they are further over", () => {
    const budget = parseBudget(
      "# Trip\n\nbudget: 1000 · 2026-11-01 → 2026-11-30 · surprises: 0%\n\n## Categories\n- Food: 200\n- Fuel: 0\n\n## Expected\n- 2026-11-20 · Hotel · 900\n- 2026-11-20 · Fuel · 500\n- 2026-11-21 · Food · 250",
      defaults,
    );
    const f = forecast(budget, "2026-11-16");
    expect(f.worstCategory).toMatchObject({ name: "Food", budget: 20000, forecast: 25000 });
  });
});

describe("category shares", () => {
  const kitchen = parseBudget(KITCHEN, defaults);

  it("renames a category on every spent and expected cost that uses it", () => {
    const next = applyShares(kitchen, [
      { from: "Materials", name: "Supplies", amount: 23000000 },
      { from: "Labour", name: "Labour", amount: 16000000 },
      { from: "Appliances", name: "Appliances", amount: 6000000 },
    ]);
    expect(next.categories.map((c) => c.name)).toEqual(["Supplies", "Labour", "Appliances"]);
    expect(next.spent.filter((c) => c.category === "Supplies").map((c) => c.title)).toEqual(["Cabinet wood", "Sink and tap set", "Paint and primer", "Floor tiles, 24 boxes"]);
    expect(next.expected.filter((c) => c.category === "Supplies")).toHaveLength(3);
    expect([...next.spent, ...next.expected].some((c) => c.category === "Materials")).toBe(false);
    expect(serializeBudget(next)).toContain("- 2026-11-14 · Supplies · 86400 · Floor tiles, 24 boxes\n  Lanka Tiles, Nugegoda.");
  });

  it("swaps two names in one save", () => {
    const next = applyShares(kitchen, [
      { from: "Materials", name: "Labour", amount: 100 },
      { from: "Labour", name: "Materials", amount: 200 },
    ]);
    expect(next.spent[0]).toMatchObject({ title: "Cabinet wood", category: "Labour" });
    expect(next.spent[1]).toMatchObject({ title: "Mason, week 1", category: "Materials" });
  });

  it("removing a category only drops its share; its costs keep it", () => {
    const next = applyShares(kitchen, [
      { from: "Materials", name: "Materials", amount: 23000000 },
      { from: "Labour", name: "Labour", amount: 16000000 },
    ]);
    expect(next.categories).toEqual([
      { name: "Materials", amount: 23000000 },
      { name: "Labour", amount: 16000000 },
    ]);
    expect(next.spent[2]).toMatchObject({ title: "Gas hob", category: "Appliances" });
    expect(forecast(next, "2026-11-16").categories.find((c) => c.name === "Appliances")).toMatchObject({ budget: 0, spent: 4850000 });
  });

  it("adds new rows, merges rows with the same name and skips empty new rows", () => {
    const next = applyShares(kitchen, [
      { from: "Materials", name: "Materials", amount: 20000000 },
      { name: " materials ", amount: 3000000 },
      { name: "Permits", amount: 500000 },
      { name: "", amount: 0 },
      { name: "Nothing yet", amount: 0 },
      { from: "Labour", name: "", amount: 16000000 }, // a cleared name keeps the old one
    ]);
    expect(next.categories).toEqual([
      { name: "Materials", amount: 23000000 },
      { name: "Permits", amount: 500000 },
      { name: "Labour", amount: 16000000 },
    ]);
  });

  it("renames a category that only costs use, without giving it a share", () => {
    const trip = parseBudget("# Trip\n\nbudget: 1000\n\n## Spent\n- 2026-11-02 · Hotel · 100 · Night 1", defaults);
    const next = applyShares(trip, [{ from: "Hotel", name: "Rooms", amount: 0 }]);
    expect(next.categories).toEqual([]);
    expect(next.spent[0]!.category).toBe("Rooms");
  });

  it("splits a budget evenly with the remainder on the last row", () => {
    expect(splitEvenly(45000000, 3)).toEqual([15000000, 15000000, 15000000]);
    expect(splitEvenly(10000000, 3)).toEqual([3333300, 3333300, 3333400]);
    expect(splitEvenly(1050, 2)).toEqual([500, 550]);
    expect(splitEvenly(100, 0)).toEqual([]);
    expect(splitEvenly(10000000, 3).reduce((a, b) => a + b, 0)).toBe(10000000);
  });

  it("checks the shares against the budget", () => {
    expect(shareTotals(45000000, [23000000, 16000000])).toEqual({ assigned: 39000000, left: 6000000, state: "left" });
    expect(shareTotals(45000000, [23000000, 16000000, 6500000])).toEqual({ assigned: 45500000, left: -500000, state: "over" });
    expect(shareTotals(45000000, [23000000, 16000000, 6000000])).toEqual({ assigned: 45000000, left: 0, state: "done" });
  });

  it("merges categories by name, ignoring case", () => {
    expect(mergeCategories([{ name: "Tiles", amount: 100 }, { name: "tiles", amount: 50 }, { name: " ", amount: 5 }, { name: "Paint", amount: 0 }])).toEqual([
      { name: "Tiles", amount: 150 },
      { name: "Paint", amount: 0 },
    ]);
  });
});

describe("paying an expected cost in parts", () => {
  // Travel is expected to cost 1,000 and 300 of it has been paid in two parts: 700 is left.
  const TRIP = `# Trip

budget: 5000 · 2026-11-01 → 2026-11-30 · surprises: 10%

## Spent
- 2026-11-02 · Food · 500 · Lunch
- 2026-11-10 · Travel · 100 · Travel
  Bus to Kandy
  towards: tr4v31
- 2026-11-11 · Travel · 200 · Travel
  towards: tr4v31

## Expected
- 2026-11-20 · Travel · 1000 · Travel
  Buses and trains.
  id: tr4v31
- 2026-11-25 · Stay · 2000 · Hotel`;
  const trip = parseBudget(TRIP, defaults);
  const travel = () => trip.expected[0]!;

  it("reads the id of an expected cost and the payments towards it, and writes the same text back", () => {
    expect(travel()).toEqual({ date: "2026-11-20", category: "Travel", amount: 100000, title: "Travel", details: "Buses and trains.", id: "tr4v31" });
    expect(trip.spent[1]).toEqual({ date: "2026-11-10", category: "Travel", amount: 10000, title: "Travel", details: "Bus to Kandy", towards: "tr4v31" });
    expect(trip.expected[1]!.id).toBeUndefined();
    expect(serializeBudget(trip)).toBe(TRIP);
  });

  it("counts only exact id and towards lines; anything else stays in the details", () => {
    const text = `# T

budget: 100 · 2026-11-01 → 2026-11-30 · surprises: 0%

## Spent
- 2026-11-02 · Food · 5 · Lunch
  id: abc123
  towards: ABC123
  towards: abc12

## Expected
- 2026-11-20 · Food · 10 · Dinner
  towards: abc123
  id:  abc123
  id: abc1234`;
    const budget = parseBudget(text, defaults);
    expect(budget.spent[0]).toMatchObject({ details: "id: abc123\ntowards: ABC123\ntowards: abc12" });
    expect(budget.spent[0]!.towards).toBeUndefined();
    expect(budget.expected[0]).toMatchObject({ details: "towards: abc123\nid:  abc123\nid: abc1234" });
    expect(budget.expected[0]!.id).toBeUndefined();
    expect(serializeBudget(budget)).toBe(text);
  });

  it("works out what's paid and what's left, and how much over once the payments pass the estimate", () => {
    expect(progressOf(trip, travel())).toMatchObject({ estimate: 100000, paid: 30000, left: 70000, over: 0 });
    expect(progressOf(trip, travel()).payments.map((p) => p.index)).toEqual([1, 2]);
    expect(progressOf(trip, trip.expected[1]!)).toMatchObject({ paid: 0, left: 200000, over: 0, payments: [] });
    const more = payPart(trip, 0, { amount: 80000, date: "2026-11-16" });
    expect(progressOf(more, more.expected[0]!)).toMatchObject({ paid: 110000, left: 0, over: 10000 });
    expect(towardsOf(trip, trip.spent[1]!)?.title).toBe("Travel");
    expect(towardsOf(trip, trip.spent[0]!)).toBeUndefined();
  });

  it("forecasts each expected cost by what's left of it, with the allowance on that only", () => {
    const f = forecast(trip, "2026-11-16");
    // spent 800; still expected 700 + 2,000; 10% of 2,700 for surprises
    expect([f.spent, f.expected, f.allowance, f.total]).toEqual([80000, 270000, 27000, 377000]);
    expect(f.categories.find((c) => c.name === "Travel")).toMatchObject({ spent: 30000, expected: 70000, forecast: 107000 });
    expect(stillExpected(trip).map((c) => c.amount)).toEqual([70000, 200000]);
    // 800 + 700 still fits 1,600, so it is the hotel that crosses it (counting the full 1,000 would have said Nov 20)
    expect(forecast({ ...trip, budget: 160000 }, "2026-11-16").runsOut).toBe("2026-11-25");
  });

  it("goes up by the extra when the payments pass the estimate, and counts nothing left", () => {
    const over = payPart(trip, 0, { amount: 80000, date: "2026-11-16" });
    const f = forecast(over, "2026-11-16");
    expect([f.spent, f.expected, f.total]).toEqual([160000, 200000, 380000]);
    expect(f.total - forecast(trip, "2026-11-16").total).toBe(3000); // 100 over, and the 70 allowance on the 700 is gone
  });

  it("is past due only while something is left to pay", () => {
    expect(forecast(trip, "2026-11-21").pastDue.map((c) => c.title)).toEqual(["Travel"]);
    const paidUp = payPart(trip, 0, { amount: 70000, date: "2026-11-21" });
    expect(forecast(paidUp, "2026-11-21").pastDue).toEqual([]);
  });

  it("saves a part payment in the cost's category and title, linked to it, and gives a cost its id when first needed", () => {
    const hotel = payPart(trip, 1, { amount: 50000, date: "2026-11-16", details: "Deposit", receipt: "0193a8f2-0000-7000-8000-000000000002" }, () => 0.5);
    expect(hotel.expected[1]!.id).toBe("iiiiii");
    expect(hotel.spent.at(-1)).toEqual({
      date: "2026-11-16", category: "Stay", amount: 50000, title: "Hotel", details: "Deposit", receipt: "0193a8f2-0000-7000-8000-000000000002", towards: "iiiiii",
    });
    expect(serializeBudget(hotel)).toContain("- 2026-11-16 · Stay · 500 · Hotel\n  Deposit\n  receipt: 0193a8f2-0000-7000-8000-000000000002\n  towards: iiiiii");
    expect(serializeBudget(hotel)).toContain("- 2026-11-25 · Stay · 2000 · Hotel\n  id: iiiiii");
    // The forecast does not change: the deposit comes off what's left
    expect(forecast(hotel, "2026-11-16").total - forecast(trip, "2026-11-16").total).toBe(-5000); // only its allowance goes
    // Paying part of Travel again keeps its id
    expect(payPart(trip, 0, { amount: 100, date: "2026-11-16" }).expected[0]!.id).toBe("tr4v31");
  });

  it("makes ids no other cost uses", () => {
    const rolls = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0];
    const taken = { ...trip, expected: [{ ...travel(), id: "iiiiii" }] };
    expect(newCostId(taken, () => rolls.shift()!)).toBe("000000");
    expect(newCostId(trip)).toMatch(/^[0-9a-z]{6}$/);
  });

  it("Paid on a partly paid cost starts from what's left and closes it", () => {
    expect([amountToPay(trip, travel()), amountToPay(trip, trip.expected[1]!)]).toEqual([70000, 200000]);
    const paid = markPaid(trip, 0, { amount: 70000, date: "2026-11-16" });
    expect(paid.expected.map((c) => c.title)).toEqual(["Hotel"]);
    expect(paid.spent.at(-1)).toEqual({ date: "2026-11-16", category: "Travel", amount: 70000, title: "Travel", details: "Buses and trains." });
    expect(paid.spent.some((c) => c.towards)).toBe(false);
    expect(serializeBudget(paid)).not.toMatch(/towards:|id:/);
    // Paying exactly what's left: the 700 is now spent instead of expected, and its 70 allowance goes
    expect(forecast(paid, "2026-11-16").total).toBe(forecast(trip, "2026-11-16").total - 7000);
  });

  it("Done removes the cost, so what was left drops out; its payments stay as spent", () => {
    const done = finishExpected(trip, 0);
    expect(done.expected.map((c) => c.title)).toEqual(["Hotel"]);
    expect(done.spent.map((c) => c.amount)).toEqual([50000, 10000, 20000]);
    expect(done.spent.some((c) => c.towards)).toBe(false);
    expect(forecast(done, "2026-11-16").total).toBe(forecast(trip, "2026-11-16").total - 77000); // 700 left + its 70
    expect(serializeBudget(done)).toContain("- 2026-11-10 · Travel · 100 · Travel\n  Bus to Kandy\n- 2026-11-11");
  });

  it("deleting a payment puts it back into what's left; deleting the cost keeps its payments", () => {
    const fewer = removeCost(trip, "spent", 2);
    expect(progressOf(fewer, fewer.expected[0]!)).toMatchObject({ paid: 10000, left: 90000 });
    const gone = removeCost(trip, "expected", 0);
    expect(gone.spent.map((c) => [c.amount, c.towards])).toEqual([[50000, undefined], [10000, undefined], [20000, undefined]]);
    expect(serializeBudget(gone)).not.toContain("towards:");
  });

  it("leaves old projects without ids as they were", () => {
    const kitchen = parseBudget(KITCHEN, defaults);
    expect(kitchen.expected.every((c) => c.id === undefined && progressOf(kitchen, c).left === c.amount)).toBe(true);
    expect(serializeBudget(finishExpected(kitchen, 0))).not.toMatch(/towards:|id:/);
  });
});
