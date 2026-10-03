import { useEffect } from "react";
import { useToast } from "../components/Toaster";
import { onSyncRequest, outboxSender } from "./api";
import { sendPendingChanges, usePendingCount } from "./outbox";
import { useInvalidateNotes } from "./queries";

/** How often the app tries again while changes are waiting and nothing else prompted it. */
const RETRY_MS = 30_000;

/**
 * Sends the changes kept on this device (lib/outbox.ts) while the app is open and the account's notes can be read:
 * at once, when the browser comes back online or the app is shown again, when a save asks for it, and every half
 * minute while changes are waiting. The lists are refreshed afterwards, and the person is told when an edit had to be
 * saved as a separate note or could not be saved.
 */
export function useOutboxSync(enabled: boolean): void {
  const pending = usePendingCount();
  const invalidate = useInvalidateNotes();
  const toast = useToast();

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const run = () => {
      void sendPendingChanges(outboxSender)
        .then((result) => {
          if (stopped) return;
          if (result.sent > 0 || result.copies > 0) void invalidate();
          if (result.copies > 0) {
            toast.info(
              result.copies === 1
                ? "A note you edited offline was changed elsewhere meanwhile. Your version was saved as a separate note."
                : `${result.copies} notes you edited offline were changed elsewhere meanwhile. Your versions were saved as separate notes.`,
            );
          }
          for (const message of result.failed) toast.error(`A change made offline could not be saved: ${message}`);
        })
        .catch(() => undefined);
    };
    const onVisible = () => document.visibilityState === "visible" && run();
    run();
    onSyncRequest(run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = pending > 0 ? window.setInterval(run, RETRY_MS) : undefined;
    return () => {
      stopped = true;
      onSyncRequest(null);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
    // Only whether anything is waiting matters here, not how much.
  }, [enabled, pending > 0]);
}
