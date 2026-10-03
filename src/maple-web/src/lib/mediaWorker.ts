import { useEffect, useState, useSyncExternalStore } from "react";
import type { DataKeys } from "../crypto/datakey";
import { fetchDecrypted } from "./noteCrypto";
import type { Attachment } from "./types";

// The page's side of the service worker (src/sw): registering it, sharing the unlocked key with it, and choosing where
// an attachment is loaded from.

const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
let registering = false;
let shared: { userId: string; keys: DataKeys } | null = null;

function post(): void {
  const worker = supported ? navigator.serviceWorker.controller : null;
  worker?.postMessage(shared ? { type: "keys", userId: shared.userId, keys: shared.keys } : { type: "forget" });
}

if (supported) navigator.serviceWorker.addEventListener("controllerchange", post);

/**
 * Registers the service worker, which every account uses: it keeps the app and recently read notes for offline reading,
 * and decrypts end-to-end files.
 */
export function registerServiceWorker(): void {
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

/**
 * Calls `listener` once, when a service worker takes control of a page that opened without one (the first visit, or the
 * first after an update that added the worker). Requests made before that went past it, so nothing was saved for
 * offline reading yet.
 */
export function onFirstWorkerControl(listener: () => void): () => void {
  if (!supported || navigator.serviceWorker.controller) return () => undefined;
  const once = () => {
    navigator.serviceWorker.removeEventListener("controllerchange", once);
    listener();
  };
  navigator.serviceWorker.addEventListener("controllerchange", once);
  return () => navigator.serviceWorker.removeEventListener("controllerchange", once);
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
 * The `download` attribute for a link to an attachment: the file's name for a blob: URL, which has no name of its own,
 * and nothing otherwise. The server's and the media worker's URLs name the file themselves (`Content-Disposition`), and
 * browsers do not pass requests from links with a `download` attribute to service workers: such a link to the worker's
 * /e2ee/… URL would reach the server instead, which answers it with 404, and the download would fail.
 */
export function downloadName(attachment: Pick<Attachment, "fileName">, href: string | undefined): string | undefined {
  return href?.startsWith("blob:") ? attachment.fileName : undefined;
}

/**
 * Where to load an attachment from: its own URL for a plain file; for an end-to-end file the service worker's URL,
 * or, without the worker, the whole file decrypted into a blob: URL (undefined while that loads). With `load: false`
 * nothing is downloaded yet, for a file still far off screen; the decryption starts when it becomes true.
 */
export function useAttachmentSrc(attachment: Attachment, options: { download?: boolean; load?: boolean } = {}): string | undefined {
  const worker = useMediaWorker();
  const [blobUrl, setBlobUrl] = useState<{ id: string; url: string } | null>(null);
  const needsBlob = attachment.endToEnd === true && !worker && options.load !== false;

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

  if (!attachment.endToEnd) {
    if (!options.download) return attachment.url;
    const url = new URL(attachment.url, "http://localhost"); // the server's URL already names the stored version
    url.searchParams.set("download", "true");
    return url.pathname + url.search;
  }
  if (worker) return `/e2ee/attachments/${attachment.id}${options.download ? "?download=1" : ""}`;
  return blobUrl?.id === attachment.id ? blobUrl.url : undefined;
}
