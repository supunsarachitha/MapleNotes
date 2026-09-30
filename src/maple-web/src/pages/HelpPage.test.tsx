import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GUIDE } from "../help/guide";
import { queryKeys } from "../lib/queries";
import type { AuthStatus } from "../lib/types";
import { HelpPage } from "./HelpPage";

function renderHelp(status?: Partial<AuthStatus>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (status) client.setQueryData<AuthStatus>(queryKeys.status, { setupRequired: false, registrationOpen: false, user: null, ...status });
  return render(
    <QueryClientProvider client={client}>
      <HelpPage />
    </QueryClientProvider>,
  );
}

describe("Help", () => {
  it("lists every section in its contents and shows them all", () => {
    renderHelp();

    const contents = screen.getByRole("navigation", { name: "Contents" });
    expect(within(contents).getAllByRole("link").map((link) => link.textContent)).toEqual(GUIDE.map((section) => section.title));
    for (const section of GUIDE) {
      expect(screen.getByRole("region", { name: section.title })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Link previews" })).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("jumps to a section from the contents", async () => {
    renderHelp();
    const target = screen.getByRole("region", { name: "Backing up and restoring" });
    target.scrollIntoView = () => undefined;

    await userEvent.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("link", { name: "Backing up and restoring" }));

    expect(target).toHaveFocus();
  });

  it("does not turn example tags into links", () => {
    renderHelp();

    expect(within(screen.getByRole("region", { name: "Tags" })).queryByRole("link", { name: "#ideas" })).not.toBeInTheDocument();
  });

  it("speaks of the app by the name administrators gave it, and shows the version", () => {
    renderHelp({ branding: { appName: "Family Notes", iconUrl: null }, version: "1.6.0" });

    expect(screen.getByText("How to get the most out of Family Notes.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Opening Family Notes from other devices" })).toHaveTextContent("Family Notes encrypts your password");
    expect(screen.getByText("Family Notes · Maple Notes 1.6.0")).toBeInTheDocument();
  });
});
