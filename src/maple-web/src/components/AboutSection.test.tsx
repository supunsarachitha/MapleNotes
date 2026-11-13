import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import * as verify from "../lib/verifyApp";
import type { AuthStatus } from "../lib/types";
import { AboutSection } from "./AboutSection";

afterEach(() => vi.restoreAllMocks());

function renderAbout(version = "1.22.0") {
  vi.spyOn(api, "status").mockResolvedValue({ version } as AuthStatus);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AboutSection />
    </QueryClientProvider>,
  );
}

const checked = {
  kind: "checked" as const,
  version: "1.22.0",
  fingerprint: "ab".repeat(32),
  checked: 12,
  changed: [],
  missing: [],
  unlisted: [],
};

describe("Settings → About", () => {
  it("says that a taken-over server could fake the check, and reports a match", async () => {
    vi.spyOn(verify, "verifyApp").mockResolvedValue(checked);
    renderAbout();

    expect(await screen.findByText("This server runs Maple Notes 1.22.0.")).toBeInTheDocument();
    expect(screen.getByText(/A server that was taken over can fake this check as well/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verify this app" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      `All 12 files match the list for Maple Notes 1.22.0.Fingerprint of the list (SHA-256): ${"ab".repeat(32)}.`,
    );
  });

  it("lists the files that differ and warns before the password is entered", async () => {
    vi.spyOn(verify, "verifyApp").mockResolvedValue({
      ...checked,
      changed: ["/assets/index-abc.js"],
      unlisted: ["/assets/injected.js"],
    });
    renderAbout("1.23.0");

    await userEvent.click(await screen.findByRole("button", { name: "Verify this app" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("2 files do not match the list for Maple Notes 1.22.0. Do not enter your password");
    expect(within(status).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "/assets/index-abc.js: different from the list",
      "/assets/injected.js: loaded, but not on the list",
    ]);
    expect(status).toHaveTextContent("The server says it runs 1.23.0, but the list is for 1.22.0.");
  });

  it("explains when the server publishes no manifest", async () => {
    vi.spyOn(verify, "verifyApp").mockResolvedValue({ kind: "unavailable", reason: "This server does not publish a build manifest." });
    renderAbout();

    await userEvent.click(await screen.findByRole("button", { name: "Verify this app" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This server does not publish a build manifest.");
  });
});
