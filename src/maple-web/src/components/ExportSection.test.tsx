import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { render as renderDom, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { setConfirmer } from "../lib/confirmation";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { buildExportUrl, ExportSection } from "./ExportSection";

// The section includes the restore panel, which refreshes note lists after a restore.
const render = (ui: ReactElement) => renderDom(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("buildExportUrl", () => {
  it("includes every option and omits empty dates", () => {
    const url = new URL(
      buildExportUrl({ format: "json", layout: "day", includeArchived: true, includeAttachments: false, timeZone: "Asia/Tokyo" }),
      "http://localhost",
    );

    expect(url.pathname).toBe("/api/v1/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "json",
      layout: "day",
      includeArchived: "true",
      includeAttachments: "false",
      timeZone: "Asia/Tokyo",
    });
  });
});

describe("ExportSection", () => {
  beforeEach(() => {
    vi.spyOn(api.confirmation, "status").mockResolvedValue({ confirmedUntilUtc: "2026-11-12T22:40:00Z" });
  });

  afterEach(() => {
    setConfirmer(null);
    vi.restoreAllMocks();
  });

  it("asks the person to confirm it is them first when the session is not recently confirmed", async () => {
    vi.spyOn(api.confirmation, "status").mockResolvedValue({ confirmedUntilUtc: null });
    const confirmer = vi.fn(async () => true);
    setConfirmer(confirmer);
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<ExportSection onDownload={onDownload} />);

    await user.click(screen.getByRole("button", { name: /Download ZIP/ }));

    expect(confirmer).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("does not download when the person cancels the confirmation", async () => {
    vi.spyOn(api.confirmation, "status").mockResolvedValue({ confirmedUntilUtc: null });
    setConfirmer(async () => false);
    const onDownload = vi.fn();
    const browserExport = vi.fn(async () => undefined);
    const person = userEvent.setup();
    render(
      <ExportSection
        user={{ id: "u", username: "maple", displayName: "Maple", role: "User", encryptionMode: "EndToEnd", hasEndToEndKey: true, createdAtUtc: "", preferences: DEFAULT_PREFERENCES }}
        onDownload={onDownload}
        browserExport={browserExport}
      />,
    );

    await person.click(screen.getByRole("button", { name: /Download ZIP/ }));

    expect(onDownload).not.toHaveBeenCalled();
    expect(browserExport).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("downloads with the chosen format, layout and range", async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<ExportSection onDownload={onDownload} />);

    await user.click(screen.getByLabelText(/Plain text/));
    await user.selectOptions(screen.getByLabelText("Folders"), "year");
    await user.type(screen.getByLabelText("From (optional)"), "2026-01-01");
    await user.click(screen.getByRole("button", { name: /Download ZIP/ }));
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalled());

    const params = new URL(onDownload.mock.calls[0]?.[0] as string, "http://localhost").searchParams;
    expect(params.get("format")).toBe("txt");
    expect(params.get("layout")).toBe("year");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("timeZone")).toBeTruthy();
  });

  it("refuses a reversed date range", async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<ExportSection onDownload={onDownload} />);

    await user.type(screen.getByLabelText("From (optional)"), "2026-05-01");
    await user.type(screen.getByLabelText("To (optional)"), "2026-04-01");
    await user.click(screen.getByRole("button", { name: /Download ZIP/ }));

    expect(onDownload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("The start date must not be after the end date.");
  });

  it("builds the archive in the browser for an account with end-to-end notes", async () => {
    const onDownload = vi.fn();
    const browserExport = vi.fn(async () => undefined);
    const person = userEvent.setup();
    render(
      <ExportSection
        user={{ id: "u", username: "maple", displayName: "Maple", role: "User", encryptionMode: "EndToEnd", hasEndToEndKey: true, createdAtUtc: "", preferences: DEFAULT_PREFERENCES }}
        onDownload={onDownload}
        browserExport={browserExport}
      />,
    );

    expect(screen.getByText(/this browser decrypts them and builds the archive/)).toBeInTheDocument();
    await person.click(screen.getByLabelText(/JSON/));
    await person.click(screen.getByRole("button", { name: /Download ZIP/ }));

    await vi.waitFor(() => expect(browserExport).toHaveBeenCalled());
    expect(onDownload).not.toHaveBeenCalled();
    expect(browserExport).toHaveBeenCalledWith(expect.objectContaining({ format: "json", layout: "month" }), "maple", expect.any(Function));
  });
});
