import { describe, expect, it, vi } from "vitest";

// A page that opened without a service worker, as on the first visit after the worker was added.
const container = Object.assign(new EventTarget(), { controller: null as object | null });
Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
const { onFirstWorkerControl } = await import("./mediaWorker");

describe("the service worker taking over", () => {
  it("tells the page once, so it can fetch through the worker what it fetched before", () => {
    const listener = vi.fn();
    onFirstWorkerControl(listener);

    container.controller = {};
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange")); // a later version taking over: the first one saved already

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a page the worker already controls", () => {
    const listener = vi.fn();
    onFirstWorkerControl(listener);
    container.dispatchEvent(new Event("controllerchange"));

    expect(listener).not.toHaveBeenCalled();
  });
});
