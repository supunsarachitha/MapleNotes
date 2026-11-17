import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toaster";
import { api } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus, Note, Preferences } from "../lib/types";
import { BudgetsPage } from "./BudgetsPage";

const project = (id: string, content: string, createdAtUtc = "2026-10-01T08:00:00Z"): Note => ({
  id,
  kind: "Budget",
  content,
  isPinned: false,
  isArchived: false,
  createdAtUtc,
  updatedAtUtc: createdAtUtc,
  tags: [],
  attachments: [],
});

// Today is 16 November 2026. The kitchen is forecast 5,100 over; the office has 19,000 to spare; the trip has ended.
const kitchen = project(
  "b-kitchen",
  "# Kitchen\n\nbudget: 450000 · 2026-10-01 → 2026-12-20 · surprises: 10%\n\n## Spent\n- 2026-11-14 · Materials · 370400 · Tiles\n\n## Expected\n- 2026-12-02 · Materials · 77000 · Countertop",
);
const office = project("b-office", "# Home office\n\nbudget: 150000 · 2026-11-01 → 2026-11-30 · surprises: 0%\n\n## Spent\n- 2026-11-02 · Desk · 41000 · Desk\n\n## Expected\n- 2026-11-20 · Chair · 90000 · Chair", "2026-09-01T08:00:00Z");
const trip = project("b-trip", "# Kandy trip\n\nbudget: 60000 · 2026-10-01 → 2026-10-05 · surprises: 0%\n\n## Spent\n- 2026-10-02 · Travel · 50000 · Train");

function renderWith(children: ReactNode, preferences: Partial<Preferences> = {}) {
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
      preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  );
}

const serve = (notes: Note[]) =>
  vi.spyOn(api, "listNotes").mockImplementation(async (params) => ({ items: params.state === "archived" ? [] : notes, nextCursor: null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Budgets", () => {
  it("says when Budgets are turned off, as they are by default", () => {
    renderWith(<BudgetsPage />);

    expect(screen.getByText("Budgets are turned off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn it on in Settings." })).toHaveAttribute("href", "/settings");
  });

  it("explains what Budgets are for when there are no projects", async () => {
    serve([]);
    renderWith(<BudgetsPage />, { budgets: true, budgetCurrency: "USD" });

    expect(await screen.findByText("See what a project will really cost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("lists active projects with their forecast, and the totals of the active ones", async () => {
    const list = serve([kitchen, office, trip]);
    renderWith(<BudgetsPage />, { budgets: true, budgetCurrency: "USD" });

    const projects = within(await screen.findByRole("list", { name: "Active projects" }));
    const [first, second] = projects.getAllByRole("link");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["Budget"], state: "active" }));
    expect(first).toHaveAttribute("href", "/budgets/b-kitchen");
    // Spent 370,400 + expected 77,000 + 10% of 77,000 for surprises = 455,100, 5,100 over the 450,000 budget.
    expect(first).toHaveTextContent("KitchenForecast overForecast $455,100 of $450,000Spent $370,400$5,100 over");
    expect(second).toHaveTextContent("Home officeOn budgetForecast $131,000 of $150,000Spent $41,000$19,000 to spare");
    expect(screen.getByText("Budgets (active)").nextSibling).toHaveTextContent("$600,000");
    expect(screen.getByText("Forecast").nextSibling).toHaveTextContent("$586,100");

    await userEvent.click(screen.getByRole("button", { name: "Finished" }));
    const finished = within(screen.getByRole("list", { name: "Finished projects" }));
    expect(finished.getByRole("link")).toHaveTextContent("Kandy trip");
  });

  it("creates a project in two steps, with its first forecast, and opens it", async () => {
    serve([]);
    const create = vi.spyOn(api, "createNote").mockImplementation(async (content) => project("b-new", content));
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-LK"]);
    window.history.replaceState(null, "", "/budgets");
    renderWith(<BudgetsPage />, { budgets: true, budgetSurprisePercent: 15 });

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const first = within(await screen.findByRole("dialog", { name: "New project" }));
    await userEvent.click(first.getByRole("button", { name: "Next" }));
    expect(first.getByRole("alert")).toHaveTextContent("Give the project a name.");
    await userEvent.click(first.getByRole("button", { name: "Renovation" }));
    await userEvent.type(first.getByRole("textbox", { name: "Budget" }), "450,000");
    await userEvent.click(first.getByRole("button", { name: "Next" }));

    const second = within(await screen.findByRole("dialog", { name: "What do you expect to pay for?" }));
    expect(second.getByRole("radio", { name: "15%" })).toHaveAttribute("aria-checked", "true");
    await userEvent.type(second.getByRole("textbox", { name: "Amount 1" }), "400000");
    expect(second.getByText(/^Forecast/)).toHaveTextContent("Forecast Rs 460,000 (with Rs 60,000, 15%, for surprises) of Rs 450,000: Rs 10,000 over before you start.");
    await userEvent.click(second.getByRole("radio", { name: "10%" }));
    await userEvent.click(second.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        "# Renovation\n\nbudget: 450000 · 2026-11-16 → 2026-12-16 · surprises: 10%\n\n## Categories\n- Materials: 400000\n\n## Expected\n- 2026-12-16 · Materials · 400000 · Materials",
        [],
        { kind: "Budget" },
      ),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ budgetCurrency: "LKR" })));
    expect(window.location.pathname).toBe("/budgets/b-new");
    window.history.replaceState(null, "", "/");
  });

  async function newTripWithCosts() {
    serve([]);
    const create = vi.spyOn(api, "createNote").mockImplementation(async (content) => project("b-new", content));
    vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    window.history.replaceState(null, "", "/budgets");
    renderWith(<BudgetsPage />, { budgets: true, budgetCurrency: "USD", budgetSurprisePercent: 0 });
    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const first = within(await screen.findByRole("dialog", { name: "New project" }));
    await userEvent.type(first.getByRole("textbox", { name: "Name" }), "Trip");
    await userEvent.type(first.getByRole("textbox", { name: "Budget" }), "1000");
    await userEvent.click(first.getByRole("button", { name: "Next" }));
    const second = within(await screen.findByRole("dialog", { name: "What do you expect to pay for?" }));
    for (const [i, name, amount] of [[1, "Hotel", "400"], [2, "hotel", "100"], [3, "Food", "250"]] as const) {
      await userEvent.type(second.getByRole("textbox", { name: `Cost ${i}` }), name);
      await userEvent.type(second.getByRole("textbox", { name: `Amount ${i}` }), amount);
    }
    return { create, second };
  }

  it("makes the listed costs the categories, with their amounts as shares and the same names merged", async () => {
    const { create, second } = await newTripWithCosts();
    expect(second.getByRole("switch", { name: "Use these as categories" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(second.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toBe(
      "# Trip\n\nbudget: 1000 · 2026-11-16 → 2026-12-16 · surprises: 0%\n\n## Categories\n- Hotel: 500\n- Food: 250\n\n## Expected\n- 2026-12-16 · Hotel · 400 · Hotel\n- 2026-12-16 · Hotel · 100 · hotel\n- 2026-12-16 · Food · 250 · Food",
    );
    window.history.replaceState(null, "", "/");
  });

  it("leaves the shares out when Use these as categories is turned off", async () => {
    const { create, second } = await newTripWithCosts();
    await userEvent.click(second.getByRole("switch", { name: "Use these as categories" }));
    await userEvent.click(second.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).not.toContain("## Categories");
    expect(create.mock.calls[0]![0]).toContain("- 2026-12-16 · hotel · 100 · hotel");
    window.history.replaceState(null, "", "/");
  });
});
