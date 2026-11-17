import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { Attachment, AuthStatus, Note } from "../lib/types";
import { BudgetsPage } from "./BudgetsPage";

const RECEIPT = "0193a8f2-0000-7000-8000-000000000001";
const photo: Attachment = {
  id: RECEIPT,
  fileName: "receipt.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1000,
  isImage: true,
  url: `/api/v1/attachments/${RECEIPT}`,
  createdAtUtc: "2026-11-14T08:00:00Z",
};

// Today is 16 November 2026. Spent 370,400 + expected 77,000 + 10% of it = 455,100: 5,100 over the 450,000 budget, but
// the listed costs alone (447,400) fit, so only the allowance tips it over.
const kitchen: Note = {
  id: "b-kitchen",
  kind: "Budget",
  content: `# Kitchen\n\nbudget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 10%\n\n## Spent\n- 2026-11-14 · Materials · 370400 · Tiles\n  Lanka Tiles, 24 boxes.\n  receipt: ${RECEIPT}\n\n## Expected\n- 2026-12-02 · Materials · 77000 · Countertop`,
  isPinned: false,
  isArchived: false,
  createdAtUtc: "2026-10-01T08:00:00Z",
  updatedAtUtc: "2026-11-14T08:00:00Z",
  tags: [],
  attachments: [photo],
};

function renderProject(note: Note = kitchen, path = `/budgets/${note.id}`) {
  window.history.replaceState(null, "", path);
  vi.spyOn(api, "listNotes").mockImplementation(async (params) => ({
    items: (params.state === "archived") === note.isArchived ? [note] : [],
    nextCursor: null,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u",
      username: "maple",
      displayName: "Maple",
      role: "User",
      encryptionMode: "AtRest",
      hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z",
      preferences: { ...DEFAULT_PREFERENCES, budgets: true, budgetCurrency: "USD" },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BudgetsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const saves = () =>
  vi.spyOn(api, "updateNote").mockImplementation(async (_id, content) => ({ ...kitchen, content, updatedAtUtc: "2026-11-16T15:00:00Z" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("A budget project", () => {
  it("leads with the forecast final cost and says in plain words what to do about it", async () => {
    renderProject();

    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeInTheDocument();
    const hero = within(screen.getByRole("region", { name: "Forecast" }));
    expect(hero.getByText("$455,100")).toBeInTheDocument();
    expect(hero.getByText("$5,100 over").parentElement).toHaveTextContent("$5,100 over your budget of $450,000");
    expect(hero.getByText(/Includes/)).toHaveTextContent("Includes $7,700 for surprises (10% of what's still expected)");
    expect(hero.getByRole("button", { name: "Based on your plan" })).toBeInTheDocument();
    const advice = within(screen.getByRole("list", { name: "Advice" }));
    expect(advice.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Your listed costs fit the budget, but not with the 10% for surprises.",
      "To finish on budget, trim $5,100 from what's still expected, or raise the budget.",
    ]);
    expect(screen.getByRole("img", { name: /Spent \$370,400 so far; forecast \$455,100 by Dec 20/ })).toBeInTheDocument();

    const expected = within(screen.getByRole("list", { name: "Expected costs" }));
    expect(expected.getByRole("button", { name: /^Countertop/ })).toHaveTextContent("CountertopMaterials · Dec 2$77,000");
    await userEvent.click(screen.getByRole("tab", { name: "Spent" }));
    expect(screen.getByRole("region", { name: "Sat, Nov 14" })).toHaveTextContent("Lanka Tiles, 24 boxes.");
  });

  it("adds what was spent, showing the change to the forecast before saving", async () => {
    const update = saves();
    renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Spent" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Add what you spent" }));
    await userEvent.type(sheet.getByRole("textbox", { name: "How much?" }), "1,000");
    expect(sheet.getByText(/^Forecast goes up/)).toHaveTextContent("Forecast goes up $1,000 to $456,100, $6,100 over budget.");
    expect(sheet.getByText(/^Forecast goes up/)).toHaveTextContent("If this was for one of your expected costs, use Paid or Pay part on it instead, so it isn't counted twice.");
    await userEvent.type(sheet.getByRole("textbox", { name: "What for?" }), "Paint");
    expect(sheet.getByRole("button", { name: "Materials" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(sheet.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const [id, content, attachmentIds] = update.mock.calls[0]!;
    expect(id).toBe("b-kitchen");
    expect(content).toContain("## Spent\n- 2026-11-14 · Materials · 370400 · Tiles\n  Lanka Tiles, 24 boxes.\n  receipt: " + RECEIPT + "\n- 2026-11-16 · Materials · 1000 · Paint");
    expect(attachmentIds).toEqual([RECEIPT]);
  });

  it("marks an expected cost paid with what it really cost", async () => {
    const update = saves();
    renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Mark Countertop as paid" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Mark as paid" }));
    expect(sheet.getByText("Countertop was expected to cost $77,000. Enter what you actually paid.")).toBeInTheDocument();
    const amount = sheet.getByRole("textbox", { name: "How much?" });
    expect(amount).toHaveValue("77000");
    await userEvent.clear(amount);
    await userEvent.type(amount, "80000");
    await userEvent.click(sheet.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const content = update.mock.calls[0]![1];
    expect(content).toContain("- 2026-11-16 · Materials · 80000 · Countertop");
    expect(content).not.toContain("## Expected");
  });

  it("changes the project's allowance for surprises with its live effect", async () => {
    const update = saves();
    renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Change the allowance for surprises" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Allowance for surprises" }));
    await userEvent.click(sheet.getByRole("radio", { name: "Off" }));
    expect(sheet.getByText(/^Forecast goes down/)).toHaveTextContent("Forecast goes down $7,700 to $447,400, $2,600 under budget.");
    await userEvent.click(sheet.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![1]).toContain("budget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 0%");
  });

  it("deletes a cost with its receipt photo", async () => {
    const update = saves();
    const remove = vi.spyOn(api, "deleteAttachment").mockResolvedValue(undefined);
    renderProject();

    await userEvent.click(await screen.findByRole("tab", { name: "Spent" }));
    await userEvent.click(screen.getByRole("button", { name: /^Tiles/ }));
    const view = within(await screen.findByRole("dialog", { name: "Tiles" }));
    expect(view.getByText("Receipt")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "Delete" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Delete this cost?" }));
    expect(confirm.getByText('"Tiles" ($370,400) and its photo will be deleted.')).toBeInTheDocument();
    await userEvent.click(confirm.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(RECEIPT));
    const [, content, attachmentIds] = update.mock.calls[0]!;
    expect(content).not.toContain("## Spent");
    expect(attachmentIds).toEqual([]);
  });

  it("sets each category's share, checking the total live, and renames the category on its costs", async () => {
    const update = saves();
    renderProject();

    await userEvent.click(await screen.findByRole("tab", { name: "Categories" }));
    expect(screen.getByText(/Give each category a share of the budget/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit shares" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Category shares" }));
    expect(sheet.getByRole("textbox", { name: "Category 1" })).toHaveValue("Materials");
    expect(sheet.getByText(/^Not assigned yet/)).toHaveTextContent("Not assigned yet: $450,000");

    await userEvent.type(sheet.getByRole("textbox", { name: "Share of Materials" }), "470,000");
    expect(sheet.getByText(/too much/)).toHaveTextContent("$20,000 too much");

    await userEvent.click(sheet.getByRole("button", { name: "Add category" }));
    await userEvent.type(sheet.getByRole("textbox", { name: "Category 2" }), "Labour");
    await userEvent.click(sheet.getByRole("button", { name: "Split evenly" }));
    expect(sheet.getByRole("textbox", { name: "Share of Labour" })).toHaveValue("225000");
    expect(sheet.getByText("All assigned")).toBeInTheDocument();

    const name = sheet.getByRole("textbox", { name: "Category 1" });
    await userEvent.clear(name);
    await userEvent.type(name, "Supplies");
    await userEvent.click(sheet.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const content = update.mock.calls[0]![1];
    expect(content).toContain("## Categories\n- Supplies: 225000\n- Labour: 225000");
    expect(content).toContain("- 2026-11-14 · Supplies · 370400 · Tiles");
    expect(content).toContain("- 2026-12-02 · Supplies · 77000 · Countertop");
    expect(content).not.toContain("Materials");
    const list = within(screen.getByRole("list", { name: "Categories" }));
    expect(list.getAllByRole("listitem").map((item) => item.firstChild!.textContent)).toEqual(["Supplies$230,100 over", "Labour$225,000 spare"]);
  });

  it("saves shares that do not add up, and removing a category keeps its costs", async () => {
    const update = saves();
    renderProject({ ...kitchen, content: kitchen.content.replace("surprises: 10%", "surprises: 10%\n\n## Categories\n- Materials: 400000\n- Permits: 10000") });

    await userEvent.click(await screen.findByRole("tab", { name: "Categories" }));
    expect(screen.getByText("Shares").nextSibling).toHaveTextContent("$410,000 of $450,000");
    await userEvent.click(screen.getByRole("button", { name: "Edit shares" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Category shares" }));
    expect(sheet.getByText(/^Not assigned yet/)).toHaveTextContent("Not assigned yet: $40,000");
    await userEvent.click(sheet.getByRole("button", { name: "Remove Materials" }));
    await userEvent.click(sheet.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const content = update.mock.calls[0]![1];
    expect(content).toContain("## Categories\n- Permits: 10000\n\n## Spent\n- 2026-11-14 · Materials · 370400 · Tiles");
  });

  it("names the category that overruns its share in the advice, and none without shares", async () => {
    renderProject({ ...kitchen, content: kitchen.content.replace("surprises: 10%", "surprises: 10%\n\n## Categories\n- Materials: 400000\n- Fees: 0") });

    const advice = within(await screen.findByRole("list", { name: "Advice" }));
    expect(advice.getAllByRole("listitem").at(-1)).toHaveTextContent("Most of it comes from Materials: forecast $455,100 against $400,000.");
    expect(screen.queryByText(/against \$0/)).not.toBeInTheDocument();
  });

  it("shows an archived project without ways to change it", async () => {
    renderProject({ ...kitchen, isArchived: true });

    expect(await screen.findByText("This project is archived. Restore it from the ⋯ menu to change it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Countertop as paid" })).not.toBeInTheDocument();
  });

  describe("paying an expected cost in parts", () => {
    // Travel is expected to cost $1,000 and $300 of it is paid: $700 is left. Spent 370,700 + still expected 77,700 + 10%.
    const trip: Note = {
      ...kitchen,
      content: `# Kitchen\n\nbudget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 10%\n\n## Spent\n- 2026-11-14 · Materials · 370400 · Tiles\n  receipt: ${RECEIPT}\n- 2026-11-15 · Travel · 300 · Travel\n  Bus to Kandy\n  towards: tr4v31\n\n## Expected\n- 2026-12-01 · Travel · 1000 · Travel\n  id: tr4v31\n- 2026-12-02 · Materials · 77000 · Countertop`,
    };

    it("shows what's paid and left on the cost, links the payment to it, and lists it in the cost's sheet", async () => {
      renderProject(trip);

      expect(await screen.findByText("$456,170")).toBeInTheDocument(); // 370,700 + 77,700 + 7,770
      const expected = within(screen.getByRole("list", { name: "Expected costs" }));
      expect(expected.getByRole("button", { name: /^Travel/ })).toHaveTextContent("TravelTravel · Dec 1$1,000$300 of $1,000 paid · $700 left");
      expect(expected.getByRole("button", { name: "Pay part of Travel" })).toBeInTheDocument();
      expect(expected.getByRole("button", { name: "Pay part of Countertop" })).toBeInTheDocument();

      await userEvent.click(expected.getByRole("button", { name: /^Travel/ }));
      const view = within(await screen.findByRole("dialog", { name: "Travel" }));
      const payments = within(view.getByRole("list", { name: "Payments towards it" }));
      expect(payments.getAllByRole("button").map((b) => b.textContent)).toEqual(["Sun, Nov 15Bus to Kandy$300"]);
      await userEvent.click(payments.getByRole("button"));
      const payment = within(await screen.findByRole("dialog", { name: "Travel" }));
      expect(payment.getByText("Towards Travel")).toBeInTheDocument();
      await userEvent.click(payment.getByRole("button", { name: "Close" }));

      await userEvent.click(screen.getByRole("tab", { name: "Spent" }));
      expect(screen.getByRole("region", { name: "Sun, Nov 15" })).toHaveTextContent("TravelTravel · towards TravelBus to Kandy$300");
    });

    it("pays part of a cost with an empty amount, shows the effect live and links the payment by a new id", async () => {
      const update = saves();
      renderProject(trip);

      await userEvent.click(await screen.findByRole("button", { name: "Pay part of Countertop" }));
      const sheet = within(await screen.findByRole("dialog", { name: "Pay part" }));
      expect(sheet.getByText(/^Paying part of/)).toHaveTextContent("Paying part of Countertop. The rest stays expected.");
      const amount = sheet.getByRole("textbox", { name: "How much?" });
      expect(amount).toHaveValue("");
      expect(sheet.getByRole("textbox", { name: "Details (optional)" })).toHaveValue("");
      expect(sheet.queryByRole("textbox", { name: "What for?" })).not.toBeInTheDocument();
      expect(sheet.getByLabelText("Date")).toHaveValue("2026-11-16");
      await userEvent.type(amount, "20,000");
      // 20,000 comes off what's left, so only its 2,000 allowance leaves the forecast
      expect(sheet.getByText(/^Forecast goes down/)).toHaveTextContent("Forecast goes down $2,000 to $454,170, $4,170 over budget.$57,000 of $77,000 left after this.");
      await userEvent.click(sheet.getByRole("button", { name: "Save payment" }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      const content = update.mock.calls[0]![1];
      const id = /- 2026-12-02 · Materials · 77000 · Countertop\n {2}id: ([0-9a-z]{6})$/.exec(content)?.[1];
      expect(id).toMatch(/^[0-9a-z]{6}$/);
      expect(content).toContain(`- 2026-11-16 · Materials · 20000 · Countertop\n  towards: ${id}`);
      expect(await screen.findByText("Paid $20,000 towards Countertop")).toBeInTheDocument();
    });

    it("shows payments past the estimate as over, in the cost's row", async () => {
      renderProject({ ...trip, content: trip.content.replace("Travel · 300 · Travel", "Travel · 1100 · Travel") });

      const expected = within(await screen.findByRole("list", { name: "Expected costs" }));
      expect(expected.getByRole("button", { name: /^Travel/ })).toHaveTextContent("$1,100 of $1,000 paid · $100 over");
      expect(expected.getByText("$100 over")).toHaveClass("text-red-700");
    });

    it("Paid on a partly paid cost starts from what's left and closes it", async () => {
      const update = saves();
      renderProject(trip);

      await userEvent.click(await screen.findByRole("button", { name: "Mark Travel as paid" }));
      const sheet = within(await screen.findByRole("dialog", { name: "Mark as paid" }));
      expect(sheet.getByRole("textbox", { name: "How much?" })).toHaveValue("700");
      expect(sheet.getByText(/was expected to cost/)).toHaveTextContent("Travel was expected to cost $1,000, and $300 of it is paid. Enter what you paid for the rest; this closes it.");
      await userEvent.click(sheet.getByRole("button", { name: "Mark paid" }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      const content = update.mock.calls[0]![1];
      expect(content).toContain("- 2026-11-15 · Travel · 300 · Travel\n  Bus to Kandy\n- 2026-11-16 · Travel · 700 · Travel\n\n## Expected\n- 2026-12-02");
      expect(content).not.toMatch(/towards:|id:/);
    });

    it("Done closes the cost: what was left drops out and the payment stays as spent", async () => {
      const update = saves();
      renderProject(trip);

      await userEvent.click(await screen.findByRole("button", { name: /^Travel/ }));
      await userEvent.click(within(await screen.findByRole("dialog", { name: "Travel" })).getByRole("button", { name: "Done" }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      const content = update.mock.calls[0]![1];
      expect(content).toContain("- 2026-11-15 · Travel · 300 · Travel\n  Bus to Kandy\n\n## Expected\n- 2026-12-02 · Materials · 77000 · Countertop");
      expect(content).not.toMatch(/towards:|id:/);
      expect(await screen.findByText("Travel is done. The $700 left is out of the forecast.")).toBeInTheDocument();
    });

    it("deleting a cost keeps its payments, and deleting a payment puts it back into what's left", async () => {
      const update = saves();
      renderProject(trip);

      await userEvent.click(await screen.findByRole("button", { name: /^Travel/ }));
      await userEvent.click(within(await screen.findByRole("dialog", { name: "Travel" })).getByRole("button", { name: "Delete" }));
      const confirm = within(await screen.findByRole("dialog", { name: "Delete this cost?" }));
      expect(confirm.getByText(/will be deleted/)).toHaveTextContent('"Travel" ($1,000) will be deleted. The payment made towards it stays as spent.');
      await userEvent.click(confirm.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0]![1]).toContain("- 2026-11-15 · Travel · 300 · Travel\n  Bus to Kandy\n\n## Expected");
      expect(update.mock.calls[0]![1]).not.toMatch(/towards:|id:/);
    });

    it("says a deleted payment goes back into what's left", async () => {
      const update = saves();
      renderProject(trip);

      await userEvent.click(await screen.findByRole("tab", { name: "Spent" }));
      await userEvent.click(screen.getByRole("button", { name: /^Travel/ }));
      await userEvent.click(within(await screen.findByRole("dialog", { name: "Travel" })).getByRole("button", { name: "Delete" }));
      const confirm = within(await screen.findByRole("dialog", { name: "Delete this cost?" }));
      expect(confirm.getByText(/will be deleted/)).toHaveTextContent('"Travel" ($300) will be deleted. Its amount goes back into what\'s left of Travel.');
      await userEvent.click(confirm.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0]![1]).toContain("## Expected\n- 2026-12-01 · Travel · 1000 · Travel\n  id: tr4v31\n");
    });
  });

  it("says so when the project is not there", async () => {
    renderProject(kitchen, "/budgets/b-gone");

    expect(await screen.findByText("This project isn't here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Budgets" })).toHaveAttribute("href", "/budgets");
  });
});
