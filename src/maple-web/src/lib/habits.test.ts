import { describe, expect, it } from "vitest";
import {
  addDays,
  dayNumber,
  daysEnding,
  habitStart,
  parseHabit,
  recentPeriods,
  scorePeriod,
  serializeHabit,
  share,
  streaks,
  toggleDay,
  weekday,
} from "./habits";

describe("habit text", () => {
  it("reads and writes a name and its days", () => {
    const text = "# Read 20 minutes\n\n- 2026-09-27\n- 2026-09-28";
    const habit = parseHabit(text);

    expect(habit).toEqual({ name: "Read 20 minutes", days: ["2026-09-27", "2026-09-28"], notes: "" });
    expect(serializeHabit(habit)).toBe(text);
    expect(serializeHabit({ name: "Stretch", days: [], notes: "" })).toBe("# Stretch");
  });

  it("sorts days, drops repeats, and keeps any other text", () => {
    const habit = parseHabit("# Walk\nEvery evening, after dinner.\n\n- 2026-09-02\n* 2026-09-01\n- 2026-09-02\n- 2026-02-30\n");

    expect(habit.days).toEqual(["2026-09-01", "2026-09-02"]);
    expect(habit.notes).toBe("Every evening, after dinner.\n\n- 2026-02-30"); // not a real day: kept as text
    expect(serializeHabit(habit)).toBe("# Walk\n\nEvery evening, after dinner.\n\n- 2026-02-30\n\n- 2026-09-01\n- 2026-09-02");
  });

  it("always has a name", () => {
    expect(serializeHabit({ name: "  ", days: ["2026-09-01"], notes: "" })).toBe("# Untitled habit\n\n- 2026-09-01");
    expect(serializeHabit({ name: "Two\nlines", days: [], notes: "" })).toBe("# Two lines");
  });

  it("ticks and unticks a day", () => {
    const habit = { name: "Run", days: ["2026-09-20", "2026-09-29"], notes: "" };

    expect(toggleDay(habit, "2026-09-25").days).toEqual(["2026-09-20", "2026-09-25", "2026-09-29"]);
    expect(toggleDay(habit, "2026-09-29").days).toEqual(["2026-09-20"]);
  });
});

describe("habit dates", () => {
  it("moves across months, years, leap days and daylight-saving changes", () => {
    expect(addDays("2025-03-29", 1)).toBe("2025-03-30"); // the switch to summer time in Europe
    expect(addDays("2025-03-30", 1)).toBe("2025-03-31");
    expect(addDays("2025-10-26", 1)).toBe("2025-10-27"); // and back
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayNumber("2026-02-29")).toBeNull();
    expect(dayNumber("not a day")).toBeNull();
    expect(weekday("2026-09-29")).toBe(2); // a Tuesday
    expect(daysEnding("2026-10-02", 4)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("counts a habit from its creation day on this device, or an earlier first day done", () => {
    const created = new Date(2026, 8, 24, 12, 30).toISOString(); // noon, local time

    expect(habitStart({ name: "Run", days: [], notes: "" }, created)).toBe("2026-09-24");
    expect(habitStart({ name: "Run", days: ["2026-09-26"], notes: "" }, created)).toBe("2026-09-24");
    expect(habitStart({ name: "Run", days: ["2026-09-20", "2026-09-26"], notes: "" }, created)).toBe("2026-09-20");
  });
});

describe("streaks", () => {
  const days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-26", "2026-09-27", "2026-09-28"];

  it("counts the current streak up to yesterday while today is open, and the best one", () => {
    expect(streaks(days, "2026-09-29")).toEqual({ current: 3, best: 4, total: 7 });
    expect(streaks([...days, "2026-09-29"], "2026-09-29")).toEqual({ current: 4, best: 4, total: 8 });
  });

  it("ends when a day is missed and ignores days after today", () => {
    expect(streaks(days, "2026-09-30")).toEqual({ current: 0, best: 4, total: 7 });
    expect(streaks([...days, "2026-10-05"], "2026-09-28")).toEqual({ current: 3, best: 4, total: 7 });
    expect(streaks([], "2026-09-29")).toEqual({ current: 0, best: 0, total: 0 });
  });
});

describe("chart periods", () => {
  it("lists weeks starting on the locale's first day, the last one holding today", () => {
    const monday = recentPeriods("weeks", "2026-09-29", 1);
    const sunday = recentPeriods("weeks", "2026-09-29", 0, 2);

    expect(monday).toHaveLength(12);
    expect(monday[11]).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(monday[0]).toEqual({ start: "2026-07-13", end: "2026-07-19" });
    expect(sunday).toEqual([
      { start: "2026-09-20", end: "2026-09-26" },
      { start: "2026-09-27", end: "2026-10-03" },
    ]);
    expect(recentPeriods("weeks", "2026-09-27", 0, 1)).toEqual([{ start: "2026-09-27", end: "2026-10-03" }]); // on the first day
  });

  it("lists months across a new year", () => {
    expect(recentPeriods("months", "2026-01-15", 1, 3)).toEqual([
      { start: "2025-11-01", end: "2025-11-30" },
      { start: "2025-12-01", end: "2025-12-31" },
      { start: "2026-01-01", end: "2026-01-31" },
    ]);
    expect(recentPeriods("months", "2024-03-10", 1, 2)[0]).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });

  it("scores the days done out of the days each habit existed, up to today", () => {
    const read = { start: "2026-09-24", days: ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"] };
    const walk = { start: "2026-09-01", days: ["2026-09-21", "2026-09-22"] };
    const lastWeek = { start: "2026-09-21", end: "2026-09-27" };
    const thisWeek = { start: "2026-09-28", end: "2026-10-04" };

    expect(scorePeriod([read], lastWeek, "2026-09-29")).toEqual({ ...lastWeek, done: 2, possible: 4 }); // from Thursday
    expect(scorePeriod([read], thisWeek, "2026-09-29")).toEqual({ ...thisWeek, done: 2, possible: 2 }); // up to today
    expect(scorePeriod([read, walk], lastWeek, "2026-09-29")).toEqual({ ...lastWeek, done: 4, possible: 11 });
    expect(scorePeriod([read], { start: "2026-09-14", end: "2026-09-20" }, "2026-09-29").possible).toBe(0);
    expect(share([{ done: 2, possible: 4 }, { done: 2, possible: 2 }])).toBe(4 / 6);
    expect(share([{ done: 0, possible: 0 }])).toBeNull();
  });
});
