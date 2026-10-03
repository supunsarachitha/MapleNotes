import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../lib/types";
import { onScreen } from "../test/viewport";

// Download links of end-to-end files on a page controlled by the media service worker. Browsers do not pass requests
// from links with a download attribute to service workers, so these links must not have one: the worker's
// Content-Disposition makes them downloads.
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: { controller: { postMessage: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() },
});
const { AttachmentGallery } = await import("./AttachmentGallery");

const file = (n: number, fileName: string, contentType: string): Attachment => ({
  id: `0192f3a3-1111-7222-8333-00000000000${n}`,
  fileName,
  contentType,
  sizeBytes: 9,
  isImage: contentType.startsWith("image/"),
  url: `/api/v1/attachments/0192f3a3-1111-7222-8333-00000000000${n}?v=1`,
  createdAtUtc: "2026-09-29T10:00:00Z",
  endToEnd: true,
});

describe("end-to-end downloads through the media worker", () => {
  it("download images from the viewer and other files from their chip, without a download attribute", async () => {
    onScreen();
    const user = userEvent.setup();
    const photo = file(1, "sunset.png", "image/png");
    render(<AttachmentGallery attachments={[photo, file(2, "plan.pdf", "application/pdf")]} />);

    const chip = screen.getByRole("link", { name: /plan\.pdf/ });
    expect(chip).toHaveAttribute("href", "/e2ee/attachments/0192f3a3-1111-7222-8333-000000000002?download=1");
    expect(chip).not.toHaveAttribute("download");

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));
    const download = within(screen.getByRole("dialog")).getByRole("link", { name: "Download sunset.png" });
    expect(download).toHaveAttribute("href", `/e2ee/attachments/${photo.id}?download=1`);
    expect(download).not.toHaveAttribute("download");
  });
});
