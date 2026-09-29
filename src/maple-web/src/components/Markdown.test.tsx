import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders GitHub-flavoured Markdown", () => {
    const { container } = render(<Markdown content={"**bold** ~~old~~\n\n- [x] done\n- [ ] todo"} />);

    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
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

  it("opens external links safely in a new tab", () => {
    render(<Markdown content="[docs](https://example.com)" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
