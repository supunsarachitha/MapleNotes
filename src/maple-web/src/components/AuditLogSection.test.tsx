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

  it("names people's own security changes and filters to them", async () => {
    const audit = vi.spyOn(api.admin, "audit").mockResolvedValue({
      items: [entry(5, { event: "PasskeyAdded", method: null, detail: 'Added the passkey "Laptop".' })],
      nextCursor: null,
    });
    renderLog();

    const list = await screen.findByRole("list", { name: "Audit log entries" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("Added a passkey");
    expect(within(list).getByRole("listitem")).toHaveTextContent('Added the passkey "Laptop".');
    await userEvent.selectOptions(screen.getByLabelText("Show"), "Security changes");
    expect(audit).toHaveBeenLastCalledWith("Security", null);
  });

  it("checks the chain on request and reports an intact log", async () => {
    vi.spyOn(api.admin, "audit").mockResolvedValue({ items: [], nextCursor: null });
    const verify = vi.spyOn(api.admin, "verifyAudit").mockResolvedValue({
      intact: true,
      checkedEntries: 42,
      uncoveredEntries: 3,
      firstBrokenId: null,
      problem: null,
      startedAtUtc: "2026-11-01T00:00:00Z",
      prunedThroughId: 0,
    });
    renderLog();

    await screen.findByText("Nothing yet.");
    expect(verify).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Check the log" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("The log is intact.");
    expect(status).toHaveTextContent("42 entries were checked: none was changed and none is missing.");
    expect(status).toHaveTextContent("3 older entries were written before the log was sealed and cannot be checked.");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("points at the first broken entry when the chain does not verify", async () => {
    vi.spyOn(api.admin, "audit").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(api.admin, "verifyAudit").mockResolvedValue({
      intact: false,
      checkedEntries: 1,
      uncoveredEntries: 0,
      firstBrokenId: 17,
      problem: "This entry was changed, or an entry just before it was deleted.",
      startedAtUtc: "2026-11-01T00:00:00Z",
      prunedThroughId: 0,
    });
    renderLog();

    await userEvent.click(await screen.findByRole("button", { name: "Check the log" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The log was tampered with.");
    expect(alert).toHaveTextContent("This entry was changed, or an entry just before it was deleted.");
    expect(alert).toHaveTextContent("The first entry affected is number 17.");
    expect(alert).toHaveTextContent("1 entry before it checks out.");
  });

  it("says so when the check cannot run", async () => {
    vi.spyOn(api.admin, "audit").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(api.admin, "verifyAudit").mockRejectedValue(new Error("offline"));
    renderLog();

    await userEvent.click(await screen.findByRole("button", { name: "Check the log" }));
    expect(await screen.findByText("The log could not be checked.")).toBeInTheDocument();
  });
});
