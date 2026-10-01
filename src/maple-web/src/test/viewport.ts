import { vi } from "vitest";

/**
 * Puts every element watched by an IntersectionObserver on screen at once, for components that wait to load until
 * they come near it (lib/viewport.ts). The setup's observer never reports anything. Undo with vi.unstubAllGlobals().
 */
export function onScreen(): void {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
}
