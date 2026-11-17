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

  it("creates a project from the sheet with the default allowance, and keeps the guessed currency", async () => {
    serve([]);
    const create = vi.spyOn(api, "createNote").mockImplementation(async (content) => project("b-new", content));
    const save = vi.spyOn(api, "setPreferences").mockImplementation(async (preferences) => preferences);
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-LK"]);
    renderWith(<BudgetsPage />, { budgets: true, budgetSurprisePercent: 15 });

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const sheet = within(await screen.findByRole("dialog", { name: "New project" }));
    await userEvent.click(sheet.getByRole("button", { name: "Create project" }));
    expect(sheet.getByRole("alert")).toHaveTextContent("Give the project a name.");
    await userEvent.type(sheet.getByRole("textbox", { name: "Name" }), "Kitchen renovation");
    await userEvent.type(sheet.getByRole("textbox", { name: "Budget" }), "450,000");
    await userEvent.click(sheet.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("# Kitchen renovation\n\nbudget: 450000 · 2026-11-16 → 2026-12-16 · surprises: 15%", [], { kind: "Budget" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ budgetCurrency: "LKR" })));
  });
});
