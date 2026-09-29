import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toaster";
import { ApiError } from "./lib/api";
import { applySavedAppearance } from "./lib/appearance";
import { queryKeys } from "./lib/queries";
import "./index.css";

applySavedAppearance(); // before the first paint, so the page never flashes in the wrong theme

// When the session ends (expired, signed out elsewhere, password changed on another device), any API call returns
// 401. Re-checking the sign-in status then shows the sign-in screen instead of a broken page.
function onError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Maple Notes: #root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
