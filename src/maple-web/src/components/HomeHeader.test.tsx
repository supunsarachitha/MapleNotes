import { describe, expect, it } from "vitest";
import { localDateKey } from "../lib/dates";
import { writingStats } from "./HomeHeader";

const today = new Date(2026, 8, 29, 10);
const key = (offset: number) => localDateKey(new Date(2026, 8, 29 - offset));

describe("HomeHeader helpers", () => {
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

describe("Home shortcuts", () => {
  it("N focuses the composer and / the search box, but not while typing", async () => {
    const { render } = await import("@testing-library/react");
    const { useHomeShortcuts } = await import("./HomeHeader");
    function Harness() {
      useHomeShortcuts();
      return (
        <>
          <input type="search" aria-label="Search notes" />
          <textarea id="composer" aria-label="New note" />
        </>
      );
    }
    const view = render(<Harness />);
    const composer = view.getByLabelText("New note");
    const search = view.getByLabelText("Search notes");
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(composer).toHaveFocus();
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    expect(composer).toHaveFocus();
    composer.blur();
    // jsdom has no layout, so the visible-search check falls back to opening navigation; the box is focused later.
    search.getClientRects = () => [{}] as unknown as DOMRectList;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    expect(search).toHaveFocus();
  });
});
