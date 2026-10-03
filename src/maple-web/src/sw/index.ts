/// <reference lib="webworker" />
import type { DataKeys } from "../crypto/datakey";
import { fromBase64 } from "../crypto/encoding";
import { loadLocalKey } from "../crypto/keystore";
import { EXPORT_PREFIX, exportResponse, registerExport } from "./exportStream";
import { MEDIA_PREFIX, serveAttachment, type Opened, type Unlocked } from "./media";
import { apiKind, dropOldShells, handleApi, handleShell, isShellRequest, saveShell, type OfflineDeps, type Shell } from "./offline";

// The app's service worker: keeps the app and what the account last read for offline reading (see offline.ts),
// decrypts end-to-end files for the page (see media.ts) and streams exports built in the browser to disk (see
// exportStream.ts). Every other request goes to the network untouched.

/** The app's files, listed by vite.sw.config.ts at build time; none in development. */
declare const __MAPLE_SHELL__: Shell | undefined;
const shell: Shell = typeof __MAPLE_SHELL__ === "undefined" ? { version: "dev", files: [] } : __MAPLE_SHELL__;

const worker = self as unknown as ServiceWorkerGlobalScope;
let current: Unlocked | null = null;
const opened = new Map<string, Promise<Opened>>();
const offline: OfflineDeps = { origin: worker.location.origin, caches: worker.caches, fetch: (request) => fetch(request) };

worker.addEventListener("install", (event) =>
  event.waitUntil(saveShell(shell, offline).then(() => worker.skipWaiting())),
);
worker.addEventListener("activate", (event) =>
  event.waitUntil(dropOldShells(shell, offline).then(() => worker.clients.claim())),
);

// The page shares its unlocked key when it unlocks, and asks the worker to forget it on sign-out.
worker.addEventListener("message", (event: ExtendableMessageEvent) => {
  const message = event.data as { type?: string; userId?: string; keys?: DataKeys; id?: string; fileName?: string };
  if (message.type === "export" && message.id && message.fileName && event.ports[0]) {
    registerExport(message.id, message.fileName, event.ports[0]);
    return;
  }
  if (message.type === "keys" && message.userId && message.keys) current = { userId: message.userId, keys: message.keys };
  if (message.type === "forget") current = null;
  opened.clear();
});

worker.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin) return;
  const kind = apiKind(event.request, worker.location.origin);
  if (kind) {
    event.respondWith(handleApi(event.request, kind, offline));
    return;
  }
  if (isShellRequest(event.request, worker.location.origin, shell)) {
    event.respondWith(handleShell(event.request, shell, offline));
    return;
  }
  if (url.pathname.startsWith(EXPORT_PREFIX)) {
    event.respondWith(exportResponse(url.pathname.slice(EXPORT_PREFIX.length)));
    return;
  }
  if (!url.pathname.startsWith(MEDIA_PREFIX)) return;
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
