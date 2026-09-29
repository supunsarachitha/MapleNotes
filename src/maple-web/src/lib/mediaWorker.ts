import { useEffect, useState, useSyncExternalStore } from "react";
import type { DataKeys } from "../crypto/datakey";
import { fetchDecrypted } from "./noteCrypto";
import type { Attachment } from "./types";

// The page's side of the media service worker (src/sw): registering it, sharing the unlocked key with it, and
// choosing where an attachment is loaded from.

const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
let registering = false;
let shared: { userId: string; keys: DataKeys } | null = null;

function post(): void {
  const worker = supported ? navigator.serviceWorker.controller : null;
  worker?.postMessage(shared ? { type: "keys", userId: shared.userId, keys: shared.keys } : { type: "forget" });
}

if (supported) navigator.serviceWorker.addEventListener("controllerchange", post);

/** Registers the media service worker, which is only needed by accounts with end-to-end files. */
export function registerMediaWorker(): void {
  if (!supported || registering) return;
  registering = true;
  // In development Vite serves the worker as a module from its source; the build emits a classic /sw.js.
  const script = import.meta.env.DEV ? "/src/sw/index.ts" : "/sw.js";
  navigator.serviceWorker
    .register(script, { scope: "/", type: import.meta.env.DEV ? "module" : "classic" })
    .catch(() => {
      registering = false; // unavailable (for example in some private windows): files are decrypted in the page
    });
}

/** Gives the worker the unlocked key, or null to make it forget; repeated whenever a new worker takes over. */
export function shareKeysWithMediaWorker(unlocked: { userId: string; keys: DataKeys } | null): void {
  shared = unlocked;
  post();
}

function subscribe(listener: () => void): () => void {
  if (!supported) return () => undefined;
  navigator.serviceWorker.addEventListener("controllerchange", listener);
  return () => navigator.serviceWorker.removeEventListener("controllerchange", listener);
}

/** Whether the media service worker controls this page, so that /e2ee/… URLs work. */
export function useMediaWorker(): boolean {
  return useSyncExternalStore(subscribe, () => supported && navigator.serviceWorker.controller !== null, () => false);
}

/**
 * Where to load an attachment from: its own URL for a plain file; for an end-to-end file the service worker's URL,
 * or, without the worker, the whole file decrypted into a blob: URL (undefined while that loads).
 */
export function useAttachmentSrc(attachment: Attachment, options: { download?: boolean } = {}): string | undefined {
  const worker = useMediaWorker();
  const [blobUrl, setBlobUrl] = useState<{ id: string; url: string } | null>(null);
  const needsBlob = attachment.endToEnd === true && !worker;

  useEffect(() => {
    if (!needsBlob) return;
    let url: string | null = null;
    let cancelled = false;
    void fetchDecrypted(attachment)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl({ id: attachment.id, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // The attachment's identity is its ID; its other fields never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, needsBlob]);

  if (!attachment.endToEnd) return options.download ? `${attachment.url}?download=true` : attachment.url;
  if (worker) return `/e2ee/attachments/${attachment.id}${options.download ? "?download=1" : ""}`;
  return blobUrl?.id === attachment.id ? blobUrl.url : undefined;
}
