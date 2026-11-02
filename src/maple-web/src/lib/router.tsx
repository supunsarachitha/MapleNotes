import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

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

/** Changes the URL without reloading and re-renders subscribers. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === currentHref()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  shown = currentHref();
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
