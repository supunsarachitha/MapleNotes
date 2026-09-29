/// <reference lib="webworker" />
import type { DataKeys } from "../crypto/datakey";
import { fromBase64 } from "../crypto/encoding";
import { loadLocalKey } from "../crypto/keystore";
import { MEDIA_PREFIX, serveAttachment, type Opened, type Unlocked } from "./media";

// The media service worker: decrypts end-to-end files for the page (see media.ts). It handles only /e2ee/…
// requests; everything else goes to the network untouched, and nothing is cached.

const worker = self as unknown as ServiceWorkerGlobalScope;
let current: Unlocked | null = null;
const opened = new Map<string, Promise<Opened>>();

worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));
worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));

// The page shares its unlocked key when it unlocks, and asks the worker to forget it on sign-out.
worker.addEventListener("message", (event: ExtendableMessageEvent) => {
  const message = event.data as { type?: string; userId?: string; keys?: DataKeys };
  if (message.type === "keys" && message.userId && message.keys) current = { userId: message.userId, keys: message.keys };
  if (message.type === "forget") current = null;
  opened.clear();
});

worker.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin || !url.pathname.startsWith(MEDIA_PREFIX)) return;
  event.respondWith(
    serveAttachment(event.request, {
      fetch: (input, init) => fetch(input, { ...init, credentials: "same-origin" }),
      unlocked,
      cache: opened,
    }),
  );
});

/**
 * The key the page shared, or (when the browser restarted this worker in between) the copy the page saved for the
 * current session, which only that session's secret opens (crypto/keystore.ts).
 */
async function unlocked(): Promise<Unlocked | null> {
  if (current) return current;
  try {
    const me = await fetch("/api/v1/auth/me", { credentials: "same-origin" });
    const secret = await fetch("/api/v1/auth/session-key", { credentials: "same-origin" });
    if (!me.ok || !secret.ok) return null;
    const { id } = (await me.json()) as { id: string };
    const keys = await loadLocalKey(id, fromBase64(((await secret.json()) as { key: string }).key));
    current = keys ? { userId: id, keys } : null;
    return current;
  } catch {
    return null;
  }
}
