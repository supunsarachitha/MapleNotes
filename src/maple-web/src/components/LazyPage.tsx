import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Button, EmptyState, Spinner } from "./ui";

/** A page's code that could not be fetched (the connection dropped, or the app was updated since it opened). */
class PageLoadFailed extends Error {}

/**
 * A page whose code is loaded the first time it opens, so the first screen does not wait for it. The service worker
 * saves every file of the build, so it also opens offline. Render it inside `LazyPageFrame`.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() =>
    load().then(
      (page) => ({ default: page }),
      (error: unknown) => {
        throw new PageLoadFailed(String(error));
      },
    ),
  );
}

/** Shown when a page's code could not be loaded; any other error goes on up as before. */
class PageLoadError extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof PageLoadFailed)) throw error;
    return (
      <div className="space-y-4 text-center">
        <EmptyState title="This page could not load">Check your connection; the app may also have been updated since it opened.</EmptyState>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

/**
 * Where pages render: a spinner while a lazy page's code loads, like the pages' own loading states. `page` names the
 * lazy page shown (or any fixed value for the others); changing it clears a failure, so another page can be opened.
 */
export function LazyPageFrame({ page, children }: { page: string; children: ReactNode }) {
  return (
    <PageLoadError key={page}>
      <Suspense
        fallback={
          <div className="flex justify-center py-12" aria-busy="true" aria-label="Loading">
            <Spinner />
          </div>
        }
      >
        {children}
      </Suspense>
    </PageLoadError>
  );
}
