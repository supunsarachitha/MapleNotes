import { afterEach, describe, expect, it } from "vitest";
import { calendarDay, currentTimeZone, dateKeyOf, dayRange, deviceTimeZone, localDateKey, setTimeZone } from "./dates";
import { formatAbsolute } from "./format";
import { habitStart } from "./habits";

afterEach(() => setTimeZone(""));

describe("the chosen time zone", () => {
  it("names the day an instant falls on there, wherever this device is", () => {
    const instant = new Date("2026-11-07T20:30:00Z");
    setTimeZone("Asia/Tokyo"); // UTC+9: already the 8th
    expect(dateKeyOf(instant)).toBe("2026-11-08");
    expect(localDateKey(calendarDay(instant))).toBe("2026-11-08");
    setTimeZone("America/Los_Angeles"); // UTC-8: still the 7th
    expect(dateKeyOf(instant)).toBe("2026-11-07");
  });

  it("asks the server for a day from its midnight to the next, there", () => {
    setTimeZone("Asia/Colombo"); // UTC+5:30
    expect(dayRange("2026-11-07")).toEqual({ createdFrom: "2026-11-06T18:30:00.000Z", createdBefore: "2026-11-07T18:30:00.000Z" });
    // A day that loses an hour to daylight saving (clocks go forward at 02:00 on 8 March 2026 in New York).
    setTimeZone("America/New_York");
    expect(dayRange("2026-03-08")).toEqual({ createdFrom: "2026-03-08T05:00:00.000Z", createdBefore: "2026-03-09T04:00:00.000Z" });
  });

  it("shows times there, and counts a habit from the day it was created there", () => {
    setTimeZone("Asia/Tokyo");
    expect(formatAbsolute("2026-11-07T20:30:00Z")).toMatch(/Nov 8, 2026.*5:30/);
    expect(habitStart({ days: [] } as never, "2026-11-07T20:30:00Z")).toBe("2026-11-08");
  });

  it("is this device's own when Automatic, or when the browser does not know the zone", () => {
    setTimeZone("Mars/Olympus_Mons");
    expect(currentTimeZone()).toBe(deviceTimeZone());
    setTimeZone("");
    expect(currentTimeZone()).toBe(deviceTimeZone());
  });
});
