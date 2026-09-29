import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

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

/** Changes the URL without reloading and re-renders subscribers. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === currentHref()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
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
