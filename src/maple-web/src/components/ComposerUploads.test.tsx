import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadAttachment } from "../lib/api";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import { shrinkPhoto } from "../lib/shrinkPhoto";
import type { Attachment, AuthStatus, Preferences } from "../lib/types";
import { Composer } from "./Composer";
import { ToastProvider } from "./Toaster";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), uploadAttachment: vi.fn() }));
vi.mock("../lib/shrinkPhoto", () => ({ shrinkPhoto: vi.fn() }));

function renderComposer(preferences: Partial<Preferences>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u",
      username: "maple",
      displayName: "Maple",
      role: "User",
      encryptionMode: "AtRest",
      hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z",
      preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Composer />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const photo = new File([new Uint8Array(5_000_000)], "IMG_1234.HEIC", { type: "image/heic" });
const stored = { id: "a1", fileName: "IMG_1234.jpg", contentType: "image/jpeg", sizeBytes: 400_000, isImage: true, url: "/a1", createdAtUtc: "" } as Attachment;

beforeEach(() => {
  vi.mocked(uploadAttachment).mockReset().mockResolvedValue(stored);
  vi.mocked(shrinkPhoto).mockReset();
});

describe("Composer uploads", () => {
  it("shrinks photos before they upload when the setting is on", async () => {
    const small = new File([new Uint8Array(400_000)], "IMG_1234.jpg", { type: "image/jpeg" });
    vi.mocked(shrinkPhoto).mockResolvedValue(small);
    renderComposer({ shrinkPhotos: true, photoSize: "Small" });

    await userEvent.upload(fileInput(), photo);

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith(small, expect.any(Function), expect.any(AbortSignal)));
    expect(shrinkPhoto).toHaveBeenCalledWith(photo, "Small");
  });

  it("uploads photos as they are when the setting is off", async () => {
    renderComposer({ shrinkPhotos: false });

    await userEvent.upload(fileInput(), photo);

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith(photo, expect.any(Function), expect.any(AbortSignal)));
    expect(shrinkPhoto).not.toHaveBeenCalled();
  });
});
