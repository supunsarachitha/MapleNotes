import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

// Counts how often react-markdown parses, while still rendering with the real library.
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  const Counted = (props: Parameters<typeof actual.default>[0]) => {
    parses.count++;
    return actual.default(props);
  };
  return { ...actual, default: Counted };
});

describe("Markdown memoisation", () => {
  it("does not re-parse when a parent re-renders with the same text, but still ticks through the newest callback", async () => {
    const content = "Plan\n\n- [ ] pack";
    const first = vi.fn();
    const view = render(<Markdown content={content} onToggleTask={first} />);
    const parsed = parses.count;

    const second = vi.fn(); // parents pass a new function on every render
    view.rerender(<Markdown content={content} onToggleTask={second} />);
    view.rerender(<Markdown content={content} onToggleTask={second} />);
    expect(parses.count).toBe(parsed);

    await userEvent.click(screen.getByRole("checkbox", { name: "pack" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(content.indexOf("- [ ] pack"));

    view.rerender(<Markdown content={"Plan\n\n- [x] pack"} onToggleTask={second} />);
    expect(parses.count).toBe(parsed + 1);
    expect(screen.getByRole("checkbox", { name: "pack" })).toBeChecked();
  });
});
