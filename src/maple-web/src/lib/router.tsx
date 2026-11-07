import { useEffect, useRef, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A minimal client-side router: the app has a handful of routes, so a small History API wrapper is enough.
// The server answers every non-API path with index.html, so deep links and reloads work.

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function currentHref(): string {
  return window.location.pathname + window.location.search;
}

// The page the app showed before the latest navigation, so a Back press can be told apart from a link click.
let shown = currentHref();

// ---------- leaving with unsaved text ----------
// A composer with unsaved text registers a guard. Leaving the page (a link, navigate(), the Back button) then waits
// for the user's answer in LeaveDialog: Save, Discard or Keep editing. Closing or reloading the tab gets the browser's
// own "Leave site?" prompt, the only one browsers allow there.

/** What a composer with unsaved text offers when the user leaves. */
export interface LeaveGuard {
  /** Whether it has unsaved text right now. */
  dirty: () => boolean;
  /** Saves; resolves false when saving failed (the user then stays). */
  save: () => Promise<boolean>;
  /** Drops the unsaved text. */
  discard: () => void;
}

const guards = new Set<{ current: LeaveGuard }>();
const dirtyGuards = () => [...guards].map((g) => g.current).filter((g) => g.dirty());

/** A navigation waiting for the user's answer. */
let pendingLeave: (() => void) | null = null;
const leaveListeners = new Set<() => void>();
const setPendingLeave = (proceed: (() => void) | null) => {
  pendingLeave = proceed;
  leaveListeners.forEach((listener) => listener());
};

/** Registers the composer's guard while it is mounted; the latest functions are used each time. */
export function useLeaveGuard(guard: LeaveGuard): void {
  const ref = useRef(guard);
  ref.current = guard;
  useEffect(() => {
    const entry = ref;
    guards.add(entry);
    return () => {
      guards.delete(entry);
    };
  }, []);
}

/** The navigation waiting for an answer, and the three answers. */
export function usePendingLeave() {
  const waiting = useSyncExternalStore(
    (listener) => {
      leaveListeners.add(listener);
      return () => leaveListeners.delete(listener);
    },
    () => pendingLeave !== null,
    () => false,
  );
  return {
    waiting,
    /** Saves every unsaved composer, then leaves; stays when one could not be saved. */
    async save(): Promise<boolean> {
      const proceed = pendingLeave;
      for (const guard of dirtyGuards()) if (!(await guard.save())) return false;
      setPendingLeave(null);
      proceed?.();
      return true;
    },
    discard() {
      const proceed = pendingLeave;
      dirtyGuards().forEach((guard) => guard.discard());
      setPendingLeave(null);
      proceed?.();
    },
    stay() {
      setPendingLeave(null);
    },
  };
}

// The address the app shows, for undoing a Back press while the user is asked.
let here = currentHref();
let passNextPop = false;

if (typeof window !== "undefined") {
  // Registered before any other popstate listener, so the address is restored before the app re-renders.
  window.addEventListener("popstate", () => {
    if (passNextPop) {
      passNextPop = false;
      here = currentHref();
      return;
    }
    // In the installed app, Back on Home stays on Home (useStayOnHome), so nothing is lost there.
    if (dirtyGuards().length > 0 && currentHref() !== here && !(isInstalledApp() && here === "/")) {
      window.history.pushState(null, "", here);
      setPendingLeave(() => {
        passNextPop = true;
        window.history.back();
      });
      return;
    }
    here = currentHref();
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirtyGuards().length === 0) return;
    event.preventDefault();
    event.returnValue = ""; // older browsers need it set to show the prompt
  });
}

/** Changes the URL without reloading and re-renders subscribers; asks first when a composer has unsaved text. */
export function navigate(to: string, options: { replace?: boolean; force?: boolean } = {}): void {
  if (to === currentHref()) return;
  if (!options.force && dirtyGuards().length > 0) {
    setPendingLeave(() => navigate(to, { ...options, force: true }));
    return;
  }
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  shown = currentHref();
  here = shown;
  listeners.forEach((listener) => listener());
  if (!options.replace) window.scrollTo({ top: 0 });
}

export interface Location {
  path: string;
  params: URLSearchParams;
}

/** The current path and query string; re-renders on navigation. */
export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, currentHref, () => "/");
  const url = new URL(href, "http://localhost");
  return { path: url.pathname, params: url.searchParams };
}

/** An anchor that navigates client-side for plain left clicks and behaves normally otherwise (new tab etc.). */
export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }

  return <a href={href} onClick={handleClick} {...props} />;
}

/** Whether the app runs as an installed app (PWA) rather than in a browser tab. */
export function isInstalledApp(): boolean {
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Keeps the Back button on the Home page ("/") from leaving it: a Back press there puts the user back on Home, so a
 * stray press (a phone's Back gesture, say) does not close the app or jump to an earlier page. Back from other pages
 * works as usual, including back to Home. Only in the installed app (PWA), not in a browser tab. Use once, in the signed-in shell.
 */
export function useStayOnHome(): void {
  useEffect(() => {
    if (!isInstalledApp()) return;
    shown = currentHref();
    // An extra entry below Home, so that Back from the first page of a visit stays inside the app too.
    if (shown === "/") window.history.pushState(null, "", shown);

    function onPopState() {
      const was = shown;
      const now = currentHref();
      if (was === "/") {
        window.history.pushState(null, "", was);
        listeners.forEach((listener) => listener());
      } else {
        shown = now;
        if (now === "/") window.history.pushState(null, "", now);
      }
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
