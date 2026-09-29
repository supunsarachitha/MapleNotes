import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GUIDE } from "../help/guide";
import { HelpPage } from "./HelpPage";

describe("Help", () => {
  it("lists every section in its contents and shows them all", () => {
    render(<HelpPage />);

    const contents = screen.getByRole("navigation", { name: "Contents" });
    expect(within(contents).getAllByRole("link").map((link) => link.textContent)).toEqual(GUIDE.map((section) => section.title));
    for (const section of GUIDE) {
      expect(screen.getByRole("region", { name: section.title })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Link previews" })).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("jumps to a section from the contents", async () => {
    render(<HelpPage />);
    const target = screen.getByRole("region", { name: "Backing up and restoring" });
    target.scrollIntoView = () => undefined;

    await userEvent.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("link", { name: "Backing up and restoring" }));

    expect(target).toHaveFocus();
  });

  it("does not turn example tags into links", () => {
    render(<HelpPage />);

    expect(within(screen.getByRole("region", { name: "Tags" })).queryByRole("link", { name: "#ideas" })).not.toBeInTheDocument();
  });
});
