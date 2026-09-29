import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Browser APIs that jsdom does not implement.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// The crypto tests run in the node environment (WebCrypto rejects jsdom's typed arrays), where there is no window.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "IntersectionObserver", { value: NoopIntersectionObserver, writable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, writable: true });
}
URL.createObjectURL ??= () => "blob:test";
URL.revokeObjectURL ??= () => undefined;
