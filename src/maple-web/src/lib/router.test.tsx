import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Link, navigate, useLocation, useStayOnHome } from "./router";

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

  describe("useStayOnHome", () => {
    function Guard() {
      useStayOnHome();
      return <CurrentLocation />;
    }
    const installed = (matches: boolean) =>
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches, addEventListener() {}, removeEventListener() {} }),
      });
    const back = () => act(() => void window.dispatchEvent(new PopStateEvent("popstate")));

    it("puts a Back press on Home back on Home in the installed app", () => {
      installed(true);
      const before = window.history.length;
      render(<Guard />);
      expect(window.history.length).toBe(before + 1); // the guard entry below Home

      back();
      expect(window.location.pathname).toBe("/");
      expect(window.history.length).toBe(before + 2);
    });

    it("leaves Back alone in a browser tab", () => {
      installed(false);
      const before = window.history.length;
      render(<Guard />);
      back();
      expect(window.history.length).toBe(before);
    });
  });
});
