import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "./types";

// A page controlled by the media service worker, as for an end-to-end account in a browser that supports it.
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: { controller: { postMessage: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() },
});
const { downloadName, useAttachmentSrc } = await import("./mediaWorker");

const photo: Attachment = {
  id: "0192f3a3-1111-7222-8333-444455556666",
  fileName: "sunset.png",
  contentType: "image/png",
  sizeBytes: 9,
  isImage: true,
  url: "/api/v1/attachments/0192f3a3-1111-7222-8333-444455556666?v=1",
  createdAtUtc: "2026-09-29T10:00:00Z",
  endToEnd: true,
};

describe("download links", () => {
  it("download end-to-end files from the media worker without a download attribute, which would bypass it", () => {
    const { result } = renderHook(() => useAttachmentSrc(photo, { download: true }));

    expect(result.current).toBe(`/e2ee/attachments/${photo.id}?download=1`);
    expect(downloadName(photo, result.current)).toBeUndefined(); // the worker names the file (Content-Disposition)
  });

  it("download plain files from the server, which names them", () => {
    const { result } = renderHook(() => useAttachmentSrc({ ...photo, endToEnd: undefined }, { download: true }));

    expect(result.current).toBe("/api/v1/attachments/0192f3a3-1111-7222-8333-444455556666?v=1&download=true");
    expect(downloadName(photo, result.current)).toBeUndefined();
  });

  it("name files decrypted into blob: URLs, which have no name of their own", () => {
    expect(downloadName(photo, "blob:http://localhost/1234")).toBe("sunset.png");
    expect(downloadName(photo, undefined)).toBeUndefined();
  });
});
