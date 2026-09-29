// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import v from "../crypto/test-vectors.json";
import { fromBase64 } from "../crypto/encoding";
import { refreshAntiforgeryToken } from "./api";
import { auth, validateNewPassword } from "./auth";

// Sign-in runs the real key derivation. The server's answers are faked with the shared test vectors, so the key sent
// must be exactly the one the C# implementation computed (docs/e2ee-spec.md §1).

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const vectorKdf = { salt: v.kdf.saltB64, memoryKiB: v.kdf.memoryKiB, iterations: v.kdf.iterations, parallelism: v.kdf.parallelism };
const user = { id: v.ids.userId, username: "maple", displayName: "maple", role: "User", encryptionEnabled: true, createdAtUtc: "" };

describe("key-derived sign-in", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockClear();
  });

  function body(call: number): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  function url(call: number): string {
    return fetchMock.mock.calls[call]?.[0] as string;
  }

  it("sends the derived authentication key, never the password", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ kdf: vectorKdf, upgrade: false }))
      .mockResolvedValueOnce(json(user))
      .mockResolvedValueOnce(json({ token: "token-2", headerName: "X-XSRF-TOKEN" }));

    await auth.signIn("maple", v.kdf.password, true);

    expect(url(0)).toBe("/api/v1/auth/prelogin");
    expect(body(0)).toEqual({ username: "maple" });
    expect(url(1)).toBe("/api/v1/auth/login");
    expect(body(1)).toEqual({ username: "maple", rememberMe: true, authKey: v.kdf.authKeyB64 });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("correct horse");
  });

  it("sends the password once when the server upgrades an older account", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ kdf: vectorKdf, upgrade: true }))
      .mockResolvedValueOnce(json(user))
      .mockResolvedValueOnce(json({ token: "token-2", headerName: "X-XSRF-TOKEN" }));

    await auth.signIn("maple", v.kdf.password, false);

    expect(body(1)).toEqual({ username: "maple", rememberMe: false, authKey: v.kdf.authKeyB64, password: v.kdf.password });
  });

  it("refuses weak parameters from the server without sending anything", async () => {
    fetchMock.mockResolvedValueOnce(json({ kdf: { ...vectorKdf, memoryKiB: 1024 }, upgrade: false }));

    await expect(auth.signIn("maple", v.kdf.password, false)).rejects.toThrow(/unsafe password settings/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("registers with a fresh salt and the default parameters", async () => {
    fetchMock.mockResolvedValueOnce(json(user, 201)).mockResolvedValueOnce(json({ token: "token-2", headerName: "X-XSRF-TOKEN" }));

    await auth.register("maple", "a long enough password", "Maple");

    const sent = body(0) as { kdf: typeof vectorKdf; authKey: string; password?: string };
    expect(sent).toMatchObject({ username: "maple", displayName: "Maple", kdf: { memoryKiB: 65536, iterations: 3, parallelism: 1 } });
    expect(fromBase64(sent.kdf.salt)).toHaveLength(16);
    expect(fromBase64(sent.authKey)).toHaveLength(32);
    expect(sent.password).toBeUndefined();
  }, 30_000);

  it("changes the password with proof of the current one and a new salt", async () => {
    fetchMock.mockResolvedValueOnce(json({ kdf: vectorKdf, upgrade: false })).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await auth.changePassword("maple", v.kdf.password, "a brand new passphrase");

    const sent = body(1) as { current: { authKey: string }; newKdf: typeof vectorKdf; newAuthKey: string };
    expect(url(1)).toBe("/api/v1/auth/password");
    expect(sent.current).toEqual({ authKey: v.kdf.authKeyB64 });
    expect(sent.newKdf.salt).not.toBe(vectorKdf.salt);
    expect(sent.newAuthKey).not.toBe(v.kdf.authKeyB64);
    expect(JSON.stringify(sent)).not.toContain("passphrase");
  }, 30_000);
});

describe("new password rules", () => {
  it("asks for at least 10 characters", () => {
    expect(validateNewPassword("short")).toMatch(/at least 10/);
    expect(validateNewPassword("          ")).toMatch(/at least 10/);
    expect(validateNewPassword("four random words here")).toBeNull();
  });
});
