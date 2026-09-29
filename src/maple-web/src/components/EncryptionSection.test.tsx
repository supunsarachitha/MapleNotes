import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { EncryptionSection } from "./EncryptionSection";

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EncryptionSection username="maple" />
    </QueryClientProvider>,
  );
}

describe("EncryptionSection", () => {
  it("asks for the password before switching, then shows conversion progress", async () => {
    const proof = { authKey: "derived-key" };
    const proveIdentity = vi.spyOn(auth, "proveIdentity").mockResolvedValue(proof);
    vi.spyOn(api, "encryption").mockResolvedValue({ enabled: true, inProgress: false, totalItems: 10, remainingItems: 0 });
    vi.spyOn(api, "status").mockResolvedValue({ setupRequired: false, registrationOpen: false, user: null });
    const setEncryption = vi
      .spyOn(api, "setEncryption")
      .mockResolvedValue({ enabled: false, inProgress: true, totalItems: 10, remainingItems: 7 });
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch", { name: "Encrypt my notes and attachments" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    await user.click(toggle);

    expect(await screen.findByRole("dialog", { name: "Turn off encryption at rest?" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(setEncryption).toHaveBeenCalledWith(false, proof));
    expect(proveIdentity).toHaveBeenCalledWith("maple", "correct horse battery staple");
    expect(await screen.findByRole("progressbar", { name: "Conversion progress" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
  });

  it("keeps the dialog open and explains a wrong password", async () => {
    vi.spyOn(auth, "proveIdentity").mockResolvedValue({ authKey: "derived-key" });
    vi.spyOn(api, "encryption").mockResolvedValue({ enabled: true, inProgress: false, totalItems: 0, remainingItems: 0 });
    vi.spyOn(api, "setEncryption").mockRejectedValue(new ApiError(400, { errors: { password: ["The password is not correct."] } }));
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch", { name: "Encrypt my notes and attachments" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await user.type(await screen.findByLabelText("Your password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    expect(await screen.findByText("The password is not correct.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
