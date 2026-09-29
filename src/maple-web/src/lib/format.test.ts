import { describe, expect, it } from "vitest";
import { formatBytes, formatRelative } from "./format";

describe("formatRelative", () => {
  const now = new Date("2026-09-28T12:00:00Z");

  it("says 'just now' for the last few seconds", () => {
    expect(formatRelative("2026-09-28T11:59:40Z", now)).toBe("just now");
  });

  it("uses minutes, hours and days for recent notes", () => {
    expect(formatRelative("2026-09-28T11:55:00Z", now)).toMatch(/5 min/);
    expect(formatRelative("2026-09-28T09:00:00Z", now)).toMatch(/3 hours? ago/);
    expect(formatRelative("2026-09-27T12:00:00Z", now)).toMatch(/yesterday|1 day ago/);
  });

  it("switches to a date after a week, adding the year only when it differs", () => {
    expect(formatRelative("2026-09-01T12:00:00Z", now)).not.toMatch(/2026/);
    expect(formatRelative("2024-09-01T12:00:00Z", now)).toMatch(/2024/);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [25 * 1024 * 1024, "25 MB"],
    [3.2 * 1024 * 1024 * 1024, "3.2 GB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
