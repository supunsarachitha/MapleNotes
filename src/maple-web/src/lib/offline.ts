import { useSyncExternalStore } from "react";

// What the page knows about being offline. The service worker answers reads from the copies it saved when the server
// cannot be reached (src/sw/offline.ts) and marks those answers, so the page can say that it is showing saved notes
// and that changes cannot be saved, even when the browser believes it is online (a server that is down, a captive
// portal).

/** The header the service worker sets on an answer from a saved copy (OFFLINE_HEADER in src/sw/offline.ts). */
const SAVED_HEADER = "X-Maple-Offline";

let showingSaved = false;
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** Records whether the latest answer from the API came from a saved copy. */
export function noteApiResponse(response: Response): void {
  const saved = response.headers.get(SAVED_HEADER) === "1";
  if (saved === showingSaved) return;
  showingSaved = saved;
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Whether the app is offline: the browser says so, or the notes shown are copies saved on this device. */
export function isOffline(): boolean {
  return showingSaved || (typeof navigator !== "undefined" && navigator.onLine === false);
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, () => false);
}
