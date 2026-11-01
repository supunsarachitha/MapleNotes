import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Note } from "../lib/types";
import { HabitChart } from "./HabitChart";

// Created at noon on this device, so each habit starts on that local day in any time zone.
const habit = (id: string, content: string, created: Date): Note => ({
  id,
  kind: "Habit",
  content,
  isPinned: false,
  isArchived: false,
  createdAtUtc: created.toISOString(),
  updatedAtUtc: created.toISOString(),
  tags: [],
  attachments: [],
});

const read = habit("h-read", "# Read\n\n- 2026-09-27\n- 2026-09-28\n- 2026-09-29", new Date(2026, 8, 20, 12));
const walk = habit("h-walk", "# Walk\n\n- 2026-09-24\n- 2026-09-25\n- 2026-09-26\n- 2026-09-29", new Date(2026, 8, 24, 12));
const TODAY = "2026-09-29"; // a Tuesday

const paragraph = (text: string) => screen.getByText((_, element) => element?.tagName === "P" && element.textContent === text);
const rowTexts = (table: HTMLElement) => within(table).getAllByRole("row").map((row) => row.textContent);

describe("Habit chart", () => {
  it("shows the share of days done per week for all habits, each counted from its start", () => {
    const { container } = render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={1} />);

    const tiles = screen.getByTestId("tiles");
    expect(tiles).toHaveTextContent("This week75%Up 39 pts vs last week");
    expect(tiles).toHaveTextContent("Last 12 weeks44%");
    expect(tiles).toHaveTextContent("Best streak running3 days");
    expect(tiles).toHaveTextContent("Longest streak3 days");
    expect(paragraph("You're doing better than last week. Keep it up! Strongest: Walk (67%). Needs attention: Read (30%).")).toBeInTheDocument();
    const ranked = within(screen.getByRole("list", { name: "Habits ranked" })).getAllByRole("button");
    expect(ranked.map((b) => b.textContent)).toEqual([
      "67Walk67% done · streak 1 day · best 3 days",
      "30Read30% done · streak 3 days · best 3 days",
    ]);
    expect(screen.getByTestId("bar-detail")).toHaveTextContent("Week of Sep 28: 75% · 3 of 4 days done");
    const table = screen.getByRole("table", { name: "Share of days done per week, all habits" });
    const rows = rowTexts(table);
    expect(rows).toHaveLength(13);
    expect(rows[1]).toBe("Week of Jul 13—No habits yet"); // before any habit: no bar
    expect(rows.slice(-3)).toEqual(["Week of Sep 140%0 of 1 day", "Week of Sep 2136%4 of 11 days", "Week of Sep 2875%3 of 4 days"]);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(3);
    expect(screen.queryByText("Current streak")).not.toBeInTheDocument();
  });

  it("shows one habit with its streaks", async () => {
    const user = userEvent.setup();
    render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={1} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Habits in the chart" }), "Walk");

    const tiles = screen.getByTestId("tiles");
    expect(tiles).toHaveTextContent("This week50%Down 25 pts vs last week");
    expect(tiles).toHaveTextContent("Last 12 weeks67%");
    expect(tiles).toHaveTextContent("Current streak1 day");
    expect(tiles).toHaveTextContent("Best streak3 days4 days done in total");
    expect(screen.getByRole("table", { name: "Share of days done per week, Walk" })).toBeInTheDocument();
  });

  it("shows a tapped bar's numbers and picks a habit from the ranking", async () => {
    const user = userEvent.setup();
    const { container } = render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={1} />);

    await user.click(container.querySelectorAll("[data-bar]")[1]!);
    expect(screen.getByTestId("bar-detail")).toHaveTextContent("Week of Sep 21: 36% · 4 of 11 days done");

    await user.click(screen.getByRole("button", { name: /Read/ }));
    expect(screen.getByRole("combobox", { name: "Habits in the chart" })).toHaveValue("h-read");
    expect(screen.getByTestId("tiles")).toHaveTextContent("Current streak3 days");
  });

  it("switches to months", async () => {
    const user = userEvent.setup();
    render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={1} />);
    const months = screen.getByRole("button", { name: "Months" });

    await user.click(months);

    expect(months).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Weeks" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("tiles")).toHaveTextContent("This month44%No earlier month yet");
    const rows = rowTexts(screen.getByRole("table", { name: "Share of days done per month, all habits" }));
    expect([rows[1], rows[12]]).toEqual(["October 2025—No habits yet", "September 202644%7 of 16 days"]);
  });

  it("starts weeks on the locale's first day", () => {
    render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={0} />);

    const rows = rowTexts(screen.getByRole("table", { name: "Share of days done per week, all habits" }));
    expect(rows.at(-1)).toBe("Week of Sep 2767%4 of 6 days"); // Sunday to today
  });

  it("goes back to all habits when the chosen one is archived", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HabitChart notes={[read, walk]} today={TODAY} weekStart={1} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Habits in the chart" }), "Walk");

    rerender(<HabitChart notes={[read]} today={TODAY} weekStart={1} />);

    expect(screen.getByRole("combobox", { name: "Habits in the chart" })).toHaveValue("all");
    expect(screen.getByRole("table", { name: "Share of days done per week, all habits" })).toBeInTheDocument();
  });
});
