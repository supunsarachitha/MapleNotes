import { describe, expect, it } from "vitest";
import { localDateKey } from "../lib/dates";
import { greeting, writingStats } from "./HomeHeader";

const today = new Date(2026, 8, 29, 10);
const key = (offset: number) => localDateKey(new Date(2026, 8, 29 - offset));

describe("HomeHeader helpers", () => {
  it("greets by the hour", () => {
    expect(greeting(3)).toBe("Good night");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });

  it("counts the week, the month and a streak that includes today", () => {
    const counts = new Map([
      [key(0), 2],
      [key(1), 1],
      [key(2), 1],
      [key(4), 3],
      [key(10), 5],
      [key(40), 9],
    ]);
    expect(writingStats(counts, today)).toEqual({ week: 7, month: 12, streak: 3 });
  });

  it("keeps yesterday's streak until today is written", () => {
    const counts = new Map([
      [key(1), 1],
      [key(2), 1],
    ]);
    expect(writingStats(counts, today).streak).toBe(2);
    expect(writingStats(new Map(), today)).toEqual({ week: 0, month: 0, streak: 0 });
  });
});
