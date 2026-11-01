import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus } from "../lib/types";
import { Composer, countWords } from "./Composer";
import { ToastProvider } from "./Toaster";

function renderComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<AuthStatus>(queryKeys.status, {
    setupRequired: false,
    registrationOpen: false,
    user: {
      id: "u",
      username: "maple",
      displayName: "Maple",
      role: "User",
      encryptionMode: "AtRest",
      hasEndToEndKey: false,
      createdAtUtc: "2026-09-28T12:00:00Z",
      preferences: { ...DEFAULT_PREFERENCES, noteTitles: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Composer />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Composer full screen", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one two\nthree  ")).toBe(3);
  });

  it("opens with the button, keeps the text, and closes with Escape", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText("New note"), "hello maple world");
    expect(screen.getByText("3 words")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Full screen/ }));
    const dialog = screen.getByRole("dialog", { name: "New note, full screen" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("New note")).toHaveValue("hello maple world");
    expect(screen.getByLabelText("New note")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText(/1 min read/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("toggles with Ctrl+Shift+F", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(screen.getByLabelText("New note"));
    await user.keyboard("{Control>}{Shift>}F{/Shift}{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Control>}{Shift>}F{/Shift}{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
