import { useEffect, useState } from "react";

type ServerStatus = "checking" | "healthy" | "unreachable";

/**
 * Phase 0 placeholder: confirms the SPA is served by the backend and can reach its API.
 * Replaced by the real application shell in Phase 4.
 */
export function App() {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/healthz", { signal: controller.signal })
      .then((response) => setStatus(response.ok ? "healthy" : "unreachable"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("unreachable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-maple-50 p-4 text-stone-800 dark:bg-stone-950 dark:text-stone-100">
      <section className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-stone-900">
        <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-12" />
        <h1 className="text-2xl font-semibold">Maple Notes</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Server status: <span data-testid="server-status" className="font-medium">{status}</span>
        </p>
      </section>
    </main>
  );
}
