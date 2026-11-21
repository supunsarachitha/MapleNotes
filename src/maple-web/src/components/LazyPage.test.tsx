import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPageFrame, lazyPage } from "./LazyPage";

describe("lazy pages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a spinner while the page's code loads, then the page", async () => {
    let finish: (page: () => ReactNode) => void = () => undefined;
    const Page = lazyPage(() => new Promise<() => ReactNode>((resolve) => (finish = resolve)));
    render(
      <LazyPageFrame page="settings">
        <Page />
      </LazyPageFrame>,
    );

    expect(screen.getByLabelText("Loading")).toHaveAttribute("aria-busy", "true");
    finish(() => <h1>Settings</h1>);

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();
  });

  it("offers a reload when the code cannot be fetched, and clears it when another page opens", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // React reports the caught error
    const Broken = lazyPage(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const view = render(
      <LazyPageFrame page="help">
        <Broken />
      </LazyPageFrame>,
    );

    expect(await screen.findByText("This page could not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();

    view.rerender(
      <LazyPageFrame page="app">
        <p>Home</p>
      </LazyPageFrame>,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("does not hide other errors a page throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Faulty = () => {
      throw new Error("bug");
    };

    expect(() =>
      render(
        <LazyPageFrame page="app">
          <Faulty />
        </LazyPageFrame>,
      ),
    ).toThrow("bug");
  });
});
