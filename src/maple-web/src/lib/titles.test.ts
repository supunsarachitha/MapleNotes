import { describe, expect, it } from "vitest";
import { formatDate, localDateKey } from "./dates";
import { joinTitle, splitTitle } from "./titles";
import { DATE_FORMATS } from "./types";

describe("titles", () => {
  it("reads a first-line heading as the title", () => {
    expect(splitTitle("# Trip to Algonquin\n\nPack the #camping gear")).toEqual({ title: "Trip to Algonquin", body: "Pack the #camping gear" });
    expect(splitTitle("# Only a title")).toEqual({ title: "Only a title", body: "" });
    expect(splitTitle("# Closing hashes ##\r\nbody")).toEqual({ title: "Closing hashes", body: "body" });
  });

  it("leaves text without a first-line heading alone", () => {
    for (const text of ["Just text", "## Second-level heading\nbody", "#hashtag first", "#\nbody", "", "text\n# heading later"]) {
      expect(splitTitle(text)).toEqual({ title: "", body: text });
    }
  });

  it("writes the title as a heading, and round-trips", () => {
    expect(joinTitle("  Weekend   plans ", "Hike\nSwim")).toBe("# Weekend plans\n\nHike\nSwim");
    expect(joinTitle("Title only", "  ")).toBe("# Title only");
    expect(joinTitle("", "No title")).toBe("No title");
    const note = joinTitle("Groceries", "- [ ] maple syrup\n- [x] oats");
    expect(splitTitle(note)).toEqual({ title: "Groceries", body: "- [ ] maple syrup\n- [x] oats" });
  });
});

describe("dates", () => {
  it("formats every offered date format", () => {
    const date = new Date(2026, 8, 7); // Monday, 7 September 2026 (local time)
    expect(DATE_FORMATS.map((format) => formatDate(date, format))).toEqual([
      "2026-09-07",
      "07/09/2026",
      "09/07/2026",
      "07.09.2026",
      "7 Sep 2026",
      "Sep 7, 2026",
      "Monday, 7 September 2026",
      "Monday, September 7, 2026",
    ]);
  });

  it("names the local calendar day", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
