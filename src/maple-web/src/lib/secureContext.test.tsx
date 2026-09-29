import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { hasWebCrypto } from "./secureContext";

afterEach(() => vi.unstubAllGlobals());

describe("secure connection", () => {
  it("is available in the test browser (like HTTPS or localhost)", () => {
    expect(hasWebCrypto()).toBe(true);
  });

  it("explains, instead of failing at sign-in, when the page is plain HTTP", () => {
    vi.stubGlobal("isSecureContext", false);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Maple Notes needs a secure connection" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
