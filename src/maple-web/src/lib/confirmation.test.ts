import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ensureConfirmed, refreshAntiforgeryToken, request } from "./api";
import { askToConfirm, setConfirmer } from "./confirmation";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const confirmationRequired = () =>
  json({ status: 403, title: "Confirm it is you to continue.", code: "confirmation_required" }, 403);

describe("step-up confirmation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockClear();
  });

  afterEach(() => {
    setConfirmer(null);
    vi.unstubAllGlobals();
  });

  it("asks the person and repeats a refused request once they have confirmed", async () => {
    const confirmer = vi.fn(async () => true);
    setConfirmer(confirmer);
    fetchMock.mockResolvedValueOnce(confirmationRequired()).mockResolvedValueOnce(json({ allowRegistration: true }));

    const saved = await request("PUT", "/api/v1/admin/settings", { allowRegistration: true });

    expect(saved).toEqual({ allowRegistration: true });
    expect(confirmer).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/admin/settings");
  });

  it("fails with the server's refusal when the person cancels, without repeating the request", async () => {
    setConfirmer(async () => false);
    fetchMock.mockResolvedValueOnce(confirmationRequired());

    const error = await request("DELETE", "/api/v1/admin/users/u1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("Confirm it is you to continue.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("asks only once more: a second refusal after confirming is not a loop", async () => {
    const confirmer = vi.fn(async () => true);
    setConfirmer(confirmer);
    fetchMock.mockResolvedValueOnce(confirmationRequired()).mockResolvedValueOnce(confirmationRequired());

    await expect(request("DELETE", "/api/v1/admin/users/u1")).rejects.toBeInstanceOf(ApiError);
    expect(confirmer).toHaveBeenCalledOnce();
  });

  it("shares one prompt between requests refused at the same time", async () => {
    let answer: (confirmed: boolean) => void = () => undefined;
    const confirmer = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    setConfirmer(confirmer);

    const first = askToConfirm();
    const second = askToConfirm();
    answer(true);

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(confirmer).toHaveBeenCalledOnce();
  });

  it("confirms with the password proof first before removing a passkey, so the password is asked only once", async () => {
    const confirmer = vi.fn(async () => true);
    setConfirmer(confirmer);
    fetchMock.mockResolvedValueOnce(json({ confirmedUntilUtc: "2026-11-12T22:40:00Z" })).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await api.passkeys.remove("p1", { authKey: "derived-key" });

    expect(fetchMock.mock.calls.map(([path, init]) => [path, (init as RequestInit).method])).toEqual([
      ["/api/v1/auth/confirm", "POST"],
      ["/api/v1/account/passkeys/p1", "DELETE"],
    ]);
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ proof: { authKey: "derived-key" } });
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("stops at a wrong password without sending the change", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "Invalid", errors: { password: ["The password is not correct."] } }, 400));

    const error = await api.twoFactor.disable({ proof: { authKey: "wrong" }, code: "123456" }).catch((caught: unknown) => caught);

    expect((error as ApiError).fieldError("password")).toBe("The password is not correct.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("checks the session before an export and asks only when it is not recently confirmed", async () => {
    const confirmer = vi.fn(async () => false);
    setConfirmer(confirmer);
    fetchMock.mockResolvedValueOnce(json({ confirmedUntilUtc: "2026-11-12T22:40:00Z" })).mockResolvedValueOnce(json({ confirmedUntilUtc: null }));

    expect(await ensureConfirmed()).toBe(true);
    expect(confirmer).not.toHaveBeenCalled();
    expect(await ensureConfirmed()).toBe(false);
    expect(confirmer).toHaveBeenCalledOnce();
  });
});
