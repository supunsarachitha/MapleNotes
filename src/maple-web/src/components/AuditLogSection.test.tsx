import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import { AuditLogSection } from "./AuditLogSection";

afterEach(() => vi.restoreAllMocks());

const entry = (id: number, changes: Partial<AuditEntry>): AuditEntry => ({
  id,
  atUtc: "2026-11-07T09:30:00Z",
  event: "SignIn",
  username: "maple",
  targetUsername: null,
  method: "Password",
  detail: "Signed in with the password.",
  ipAddress: "203.0.113.7",
  ...changes,
});

function renderLog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuditLogSection />
    </QueryClientProvider>,
  );
}

describe("audit log", () => {
  it("lists entries newest first, filters them, and loads older pages", async () => {
    const audit = vi
      .spyOn(api.admin, "audit")
      .mockResolvedValueOnce({
        items: [
          entry(3, { event: "AccountChanged", username: "admin", targetUsername: "member", method: null, detail: "Enabled the account." }),
          entry(2, { event: "SignInFailed", username: "nobody", detail: "Wrong username or password." }),
        ],
        nextCursor: 2,
      })
      .mockResolvedValueOnce({ items: [entry(1, {})], nextCursor: null })
      .mockResolvedValueOnce({ items: [entry(2, { event: "SignInFailed", username: "nobody", detail: "Wrong username or password." })], nextCursor: null });
    renderLog();

    const list = await screen.findByRole("list", { name: "Audit log entries" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Changed an account");
    expect(items[0]).toHaveTextContent("admin → member");
    expect(items[1]).toHaveTextContent("Sign-in refused · password");
    expect(items[1]).toHaveTextContent("203.0.113.7");

    await userEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(await within(list).findByText("Signed in with the password.")).toBeInTheDocument();
    expect(audit).toHaveBeenLastCalledWith("All", 2);
    expect(screen.queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Show"), "Failed sign-ins");
    expect(audit).toHaveBeenLastCalledWith("FailedSignIns", null);
  });
});
