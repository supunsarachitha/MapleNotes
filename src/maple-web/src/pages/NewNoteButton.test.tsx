import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import type { AuthStatus } from "../lib/types";
import { ToastProvider } from "../components/Toaster";
import { NewNoteButton } from "./HomePage";

function renderButton() {
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
        <NewNoteButton />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Home's new note button", () => {
  it("opens the editor full screen, and closing keeps the draft", async () => {
    const user = userEvent.setup();
    renderButton();
    // Closed: no box on the page, only the button.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New note").closest(".hidden")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "New note (N)" }));
    const dialog = screen.getByRole("dialog", { name: "New note, full screen" });
    expect(dialog.classList.contains("hidden")).toBe(false);
    expect(screen.getByLabelText("New note")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.queryByRole("button", { name: /Exit full screen/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("New note"), "half a thought");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    const button = screen.getByRole("button", { name: "New note (N), draft kept" });

    await user.click(button);
    expect(screen.getByLabelText("New note")).toHaveValue("half a thought");
    await user.click(screen.getByRole("button", { name: "Close (Esc); the draft is kept" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
