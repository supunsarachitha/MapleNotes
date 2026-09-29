import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Link, navigate, useLocation } from "./router";

function CurrentLocation() {
  const { path, params } = useLocation();
  return (
    <p>
      {path}|{params.get("tag") ?? "-"}
    </p>
  );
}

describe("router", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  it("re-renders on navigate", () => {
    render(<CurrentLocation />);

    act(() => navigate("/archive"));
    expect(screen.getByText("/archive|-")).toBeInTheDocument();

    act(() => navigate("/?tag=work"));
    expect(screen.getByText("/|work")).toBeInTheDocument();
  });

  it("follows links client-side on a plain click", async () => {
    render(
      <>
        <Link href="/settings">Settings</Link>
        <CurrentLocation />
      </>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(window.location.pathname).toBe("/settings");
    expect(screen.getByText("/settings|-")).toBeInTheDocument();
  });

  it("follows browser back navigation", () => {
    render(<CurrentLocation />);
    act(() => navigate("/archive"));

    act(() => {
      window.history.replaceState(null, "", "/settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByText("/settings|-")).toBeInTheDocument();
  });
});
