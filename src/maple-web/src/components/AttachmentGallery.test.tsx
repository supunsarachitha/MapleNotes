import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../lib/types";

vi.mock("../lib/noteCrypto", () => ({
  fetchDecrypted: vi.fn(async () => new Blob(["decrypted"], { type: "image/png" })),
}));

const { AttachmentGallery } = await import("./AttachmentGallery");
const { fetchDecrypted } = await import("../lib/noteCrypto");

const encrypted: Attachment = {
  id: "0192f3a3-1111-7222-8333-444455556666",
  fileName: "sunset.png",
  contentType: "image/png",
  sizeBytes: 9,
  isImage: true,
  url: "/api/v1/attachments/0192f3a3-1111-7222-8333-444455556666",
  createdAtUtc: "2026-09-29T10:00:00Z",
  endToEnd: true,
};

describe("AttachmentGallery", () => {
  it("shows plain files from their own URL", () => {
    render(<AttachmentGallery attachments={[{ ...encrypted, endToEnd: undefined }]} />);

    expect(screen.getByRole("img", { name: "sunset.png" })).toHaveAttribute("src", encrypted.url);
  });

  it("keeps the stored version in download links", () => {
    render(<AttachmentGallery attachments={[{ ...encrypted, endToEnd: undefined, isImage: false, contentType: "application/pdf", fileName: "a.pdf", url: `${encrypted.url}?v=2` }]} />);

    expect(screen.getByRole("link", { name: /a\.pdf/ })).toHaveAttribute("href", `${encrypted.url}?v=2&download=true`);
  });

  it("decrypts end-to-end files in the page when no service worker is available", async () => {
    render(<AttachmentGallery attachments={[encrypted]} />);

    await waitFor(() => expect(screen.getByRole("img", { name: "sunset.png" }).getAttribute("src")).toMatch(/^blob:/));
    expect(fetchDecrypted).toHaveBeenCalledWith(encrypted);
  });
});
