import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildExportUrl, ExportSection } from "./ExportSection";

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
  it("downloads with the chosen format, layout and range", async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<ExportSection onDownload={onDownload} />);

    await user.click(screen.getByLabelText(/Plain text/));
    await user.selectOptions(screen.getByLabelText("Folders"), "year");
    await user.type(screen.getByLabelText("From (optional)"), "2026-01-01");
    await user.click(screen.getByRole("button", { name: /Download ZIP/ }));

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
});
