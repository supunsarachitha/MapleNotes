import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders GitHub-flavoured Markdown", () => {
    const { container } = render(<Markdown content={"**bold** ~~old~~\n\n- [x] done\n- [ ] todo"} />);

    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("ticks task-list items only when the note can be changed, naming each box after its item", async () => {
    const content = "Plan\n\n- [ ] book **flights**\n- [x] pack\n  - [ ] socks\n\n> 1. [ ] quoted";
    const view = render(<Markdown content={content} />);

    expect(screen.getByRole("checkbox", { name: "book flights" })).toBeDisabled();

    const toggle = vi.fn();
    view.rerender(<Markdown content={content} onToggleTask={toggle} />);
    for (const name of ["book flights", "pack", "socks", "quoted"]) await userEvent.click(screen.getByRole("checkbox", { name }));

    // Where each item's list marker starts in the text.
    expect(toggle.mock.calls).toEqual([["- [ ] book"], ["- [x] pack"], ["- [ ] socks"], ["1. [ ]"]].map(([marker]) => [content.indexOf(marker!)]));
  });

  it("turns #tags into links to the tag view", () => {
    render(<Markdown content="Plan the trip #Travel and #work/meetings." />);

    expect(screen.getByRole("link", { name: "#Travel" })).toHaveAttribute("href", "/?tag=travel");
    expect(screen.getByRole("link", { name: "#work/meetings" })).toHaveAttribute("href", "/?tag=work%2Fmeetings");
  });

  it("leaves headings, numbers, URLs and code alone", () => {
    render(<Markdown content={"# Heading\n\nIssue #42, https://example.com/#anchor and `#code`"} />);

    expect(screen.queryByRole("link", { name: /#42|#code/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Heading");
  });

  it("never renders raw HTML from a note", () => {
    const { container } = render(<Markdown content={'<script>alert(1)</script><img src=x onerror="alert(2)"> safe'} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("safe");
  });

  it("neutralises javascript: and data: links", () => {
    const { container } = render(<Markdown content={"[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=)"} />);

    for (const link of Array.from(container.querySelectorAll("a"))) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^(javascript|data):/i);
    }
  });

  it("opens external links safely in a new tab", () => {
    render(<Markdown content="[docs](https://example.com)" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("treats //host links as other sites, not as pages of the app", () => {
    render(<Markdown content="[trash](//phish.example/login) [tags](/tags)" />);

    expect(screen.getByRole("link", { name: "trash" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "tags" })).not.toHaveAttribute("target");
  });

  it("shows only the account's own attachments as images", () => {
    const id = "0192f3a3-1111-7222-8333-444455556666";
    const { container } = render(
      <Markdown content={`![photo](/api/v1/attachments/${id}?v=2) ![export](/api/v1/export?format=json) ![pixel](https://tracker.example/p.gif)`} />,
    );

    expect(Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([`/api/v1/attachments/${id}?v=2`]);
    expect(container).toHaveTextContent("export"); // the others show their description instead
    expect(container).toHaveTextContent("pixel");
  });
});
