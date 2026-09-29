import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("opens images in a viewer that pages through a note's images", async () => {
    const plain = (n: number): Attachment => ({ ...encrypted, endToEnd: undefined, id: `0192f3a3-1111-7222-8333-00000000000${n}`, fileName: `photo-${n}.png`, url: `/a/${n}` });
    const user = userEvent.setup();
    render(<AttachmentGallery attachments={[plain(1), plain(2), plain(3)]} />);

    await user.click(screen.getByRole("button", { name: "View photo-2.png" }));
    const viewer = screen.getByRole("dialog");
    expect(within(viewer).getByText("2 / 3")).toBeInTheDocument();
    expect(within(viewer).getByRole("img", { name: "photo-2.png" })).toHaveAttribute("src", "/a/2");

    await user.click(within(viewer).getByRole("button", { name: "Next image" }));
    expect(within(viewer).getByRole("img", { name: "photo-3.png" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(within(viewer).getByRole("img", { name: "photo-1.png" })).toBeInTheDocument(); // wraps around
    await user.keyboard("{ArrowLeft}");
    expect(within(viewer).getByText("3 / 3")).toBeInTheDocument();
    expect(within(viewer).getByRole("link", { name: "Download photo-3.png" })).toHaveAttribute("href", "/a/3?download=true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a single image at its own shape and a viewer without paging", async () => {
    const user = userEvent.setup();
    render(<AttachmentGallery attachments={[{ ...encrypted, endToEnd: undefined }]} />);

    expect(screen.getByRole("img", { name: "sunset.png" })).toHaveClass("object-contain", "max-w-full", "h-auto");
    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    expect(screen.queryByRole("button", { name: "Next image" })).not.toBeInTheDocument();
  });
});
