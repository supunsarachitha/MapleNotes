import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Note } from "../lib/types";
import { HabitCalendar } from "./HabitCalendar";

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

describe("Habit calendar", () => {
  it("shows the month for all habits: all, some or none done each day, counted from each habit's start", () => {
    render(<HabitCalendar notes={[read, walk]} today={TODAY} weekStart={1} />);

    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, September 29 (today): 2 of 2 habits done")).toBeInTheDocument();
    expect(screen.getByText("Sunday, September 27: 1 of 2 habits done")).toBeInTheDocument();
    expect(screen.getByText("Monday, September 21: 0 of 1 habit done")).toBeInTheDocument();
    expect(screen.getByText("Thursday, September 10: no habits yet")).toBeInTheDocument();
    expect(screen.getByText("Wednesday, September 30: still to come")).toBeInTheDocument();
    expect(screen.getByText("44% of habit days done")).toBeInTheDocument(); // 7 of 16
    expect(screen.getByText("All done")).toBeInTheDocument();
    // September 1, 2026 is a Tuesday: in a week starting on Monday, one hidden blank comes before it.
    const days = screen.getAllByRole("listitem");
    expect(days).toHaveLength(30);
    expect(days[0]!.previousElementSibling).toHaveAttribute("aria-hidden", "true");
  });

  it("shows one habit's days and goes back a month at a time, never past this one", async () => {
    render(<HabitCalendar notes={[read, walk]} today={TODAY} weekStart={1} />);
    const next = screen.getByRole("button", { name: "Next month" });

    await userEvent.selectOptions(screen.getByLabelText("Habits in the calendar"), "h-read");

    expect(screen.getByText("Sunday, September 27: done")).toBeInTheDocument();
    expect(screen.getByText("Wednesday, September 23: not done")).toBeInTheDocument();
    expect(screen.getByText("Saturday, September 19: before this habit started")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 days done")).toBeInTheDocument();
    expect(screen.queryByText("All done")).not.toBeInTheDocument();
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));

    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText("Nothing to count in this month yet.")).toBeInTheDocument();
    expect(next).toBeEnabled();
  });
});
