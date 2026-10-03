// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptNote, encryptNote, openModeRecord } from "../crypto/content";
import { dataKeyContext, recoveryContext, unwrapRawDataKey } from "../crypto/datakey";
import { fromBase64, randomBytes, toBase64 } from "../crypto/encoding";
import { hkdfBytes, importAesKey } from "../crypto/kdf";
import { deriveRecoveryKeys, parseRecoveryKey } from "../crypto/recovery";
import v from "../crypto/test-vectors.json";
import { refreshAntiforgeryToken } from "./api";
import { auth } from "./auth";
import { e2ee } from "./e2ee";
import { DEFAULT_PREFERENCES } from "./preferences";
import type { User } from "./types";

// The browser's end-to-end key flows, run against a small stand-in for the server that stores what it receives and
// checks proofs as the real API does (the real endpoints are tested in EndToEndKeyTests.cs). The account password is
// the one from the shared test vectors, so derivations use the fast test parameters.

const userId = v.ids.userId;
const noteId = v.ids.noteId;
const vectorKdf = { salt: v.kdf.saltB64, memoryKiB: v.kdf.memoryKiB, iterations: v.kdf.iterations, parallelism: v.kdf.parallelism };
const baseUser: User = {
  id: userId,
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "AtRest",
  hasEndToEndKey: false,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Password wrapping key the server never sees, recomputed here from the vectors to inspect what it stored. */
async function wrapKeyFor(masterB64: string) {
  return importAesKey(await hkdfBytes(fromBase64(masterB64), "maple-notes/v2/wrap"));
}

function createServer() {
  const state = {
    kdf: vectorKdf as typeof vectorKdf,
    authKey: v.kdf.authKeyB64,
    wrappedKey: null as string | null,
    recoveryWrappedKey: null as string | null,
    recoveryAuthKey: null as string | null,
    modeRecord: null as string | null,
    sessionKey: toBase64(randomBytes(32)),
  };
  const wrong = (field: string) => json({ errors: { [field]: ["The password is not correct."] } }, 400);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, any>) : {};
    switch (`${init?.method ?? "GET"} ${url}`) {
      case "GET /api/v1/auth/antiforgery":
        return json({ token: "token", headerName: "X-XSRF-TOKEN" });
      case "GET /api/v1/auth/session-key":
        return json({ key: state.sessionKey });
      case "POST /api/v1/auth/prelogin":
        return json({ kdf: state.kdf, upgrade: false });
      case "GET /api/v1/account/e2ee":
        return state.wrappedKey ? json({ wrappedKey: state.wrappedKey }) : json({}, 404);
      case "POST /api/v1/account/e2ee":
        if (body.proof.authKey !== state.authKey) return wrong("password");
        Object.assign(state, {
          wrappedKey: body.wrappedKey,
          recoveryWrappedKey: body.recoveryWrappedKey,
          recoveryAuthKey: body.recoveryAuthKey,
          modeRecord: body.modeRecord,
        });
        return json({ mode: "EndToEnd", inProgress: false, totalItems: 0, remainingItems: 0 });
      case "PUT /api/v1/account/e2ee/recovery":
        if (body.proof.authKey !== state.authKey) return wrong("password");
        Object.assign(state, { recoveryWrappedKey: body.recoveryWrappedKey, recoveryAuthKey: body.recoveryAuthKey });
        return json(null, 204);
      case "PUT /api/v1/auth/password":
        if (body.current.authKey !== state.authKey) return wrong("currentPassword");
        Object.assign(state, { kdf: body.newKdf, authKey: body.newAuthKey, wrappedKey: body.newWrappedKey ?? state.wrappedKey });
        return json(null, 204);
      case "POST /api/v1/auth/recovery/key":
        if (body.recoveryAuthKey !== state.recoveryAuthKey) return json({ title: "Incorrect username or recovery key." }, 401);
        return json({ userId, recoveryWrappedKey: state.recoveryWrappedKey });
      case "POST /api/v1/auth/recovery/reset":
        if (body.recoveryAuthKey !== state.recoveryAuthKey) return json({ title: "Incorrect username or recovery key." }, 401);
        Object.assign(state, {
          kdf: body.newKdf,
          authKey: body.newAuthKey,
          wrappedKey: body.newWrappedKey,
          recoveryWrappedKey: body.newRecoveryWrappedKey,
          recoveryAuthKey: body.newRecoveryAuthKey,
          sessionKey: toBase64(randomBytes(32)), // signed in: a new session
        });
        return json({ ...baseUser, encryptionMode: "EndToEnd", hasEndToEndKey: true });
      default:
        throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
    }
  });
  return { state, fetch };
}

describe("end-to-end key management", () => {
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    server = createServer();
    vi.stubGlobal("fetch", server.fetch);
    await refreshAntiforgeryToken();
    await e2ee.forget();
  });

  async function setUp() {
    const result = await e2ee.setUp(baseUser, v.kdf.password);
    return { ...result, user: { ...baseUser, encryptionMode: "EndToEnd" as const, hasEndToEndKey: true } };
  }

  it("sets up a key that only the password and the recovery key unwrap", async () => {
    const { recoveryKey } = await setUp();

    const keys = e2ee.keysFor(userId)!;
    const note = await encryptNote(keys, userId, noteId, "secret");
    const fromPassword = await unwrapRawDataKey(await wrapKeyFor(v.kdf.masterB64), fromBase64(server.state.wrappedKey!), dataKeyContext(userId));
    const recovery = await deriveRecoveryKeys(parseRecoveryKey(recoveryKey));
    const fromRecovery = await unwrapRawDataKey(recovery.wrapKey, fromBase64(server.state.recoveryWrappedKey!), recoveryContext(userId));

    expect(fromRecovery.raw).toEqual(fromPassword.raw);
    expect(server.state.recoveryAuthKey).toBe(toBase64(recovery.authKey));
    // End-to-end mode, sealed with the new key, so the server cannot later claim the owner left it (lib/modeRecord.ts).
    expect(await openModeRecord(keys, userId, fromBase64(server.state.modeRecord!))).toEqual({ mode: "EndToEnd", epoch: 1 });
    expect(JSON.stringify(server.fetch.mock.calls)).not.toContain(v.kdf.password);
    expect(await decryptNote(keys, userId, noteId, note)).toBe("secret");
  });

  it("unlocks with the password after a reload, and explains a wrong password", async () => {
    const { user } = await setUp();
    const note = await encryptNote(e2ee.keysFor(userId)!, userId, noteId, "secret");
    e2ee.lock();

    const restored = await e2ee.restore(userId); // same session: the saved copy opens
    e2ee.lock();
    server.state.sessionKey = toBase64(randomBytes(32)); // a new session cannot open it
    const afterNewSession = await e2ee.restore(userId);
    const wrong = await e2ee.unlock(user, "not the password").catch((error: unknown) => error);
    const unlocked = await e2ee.unlock(user, v.kdf.password);

    expect(await decryptNote(restored!, userId, noteId, note)).toBe("secret");
    expect(afterNewSession).toBeNull();
    expect((wrong as { fieldError(field: string): string }).fieldError("password")).toBe("The password is not correct.");
    expect(await decryptNote(unlocked, userId, noteId, note)).toBe("secret");
  });

  it("re-wraps the key when the password changes", async () => {
    const { user } = await setUp();
    const note = await encryptNote(e2ee.keysFor(userId)!, userId, noteId, "secret");

    await auth.changePassword(user, v.kdf.password, "a brand new passphrase");
    await e2ee.forget();

    expect(server.state.kdf.salt).not.toBe(vectorKdf.salt);
    const keys = await e2ee.unlock(user, "a brand new passphrase");
    expect(await decryptNote(keys, userId, noteId, note)).toBe("secret");
  }, 30_000);

  it("replaces the recovery key", async () => {
    const { user, recoveryKey: first } = await setUp();

    const second = await e2ee.replaceRecoveryKey(user, v.kdf.password);

    expect(second).not.toBe(first);
    const recovery = await deriveRecoveryKeys(parseRecoveryKey(second));
    expect(server.state.recoveryAuthKey).toBe(toBase64(recovery.authKey));
    await expect(e2ee.replaceRecoveryKey(user, "not the password")).rejects.toMatchObject({ status: 400 });
  });

  it("resets a forgotten password with the recovery key and keeps the notes readable", async () => {
    const { user, recoveryKey } = await setUp();
    const note = await encryptNote(e2ee.keysFor(userId)!, userId, noteId, "secret");
    await e2ee.forget();

    const typo = await e2ee.recover("maple", "not a key", "a brand new passphrase").catch((error: unknown) => error);
    const recovered = await e2ee.recover("maple", ` ${recoveryKey.toLowerCase()} `, "a brand new passphrase");

    expect((typo as { fieldError(field: string): string }).fieldError("recoveryKey")).toMatch(/52 characters/);
    expect(await decryptNote(e2ee.keysFor(userId)!, userId, noteId, note)).toBe("secret"); // unlocked right away
    expect(recovered.recoveryKey).not.toBe(recoveryKey);
    await e2ee.forget();
    expect(await decryptNote(await e2ee.unlock(user, "a brand new passphrase"), userId, noteId, note)).toBe("secret");
    await expect(e2ee.recover("maple", recoveryKey, "another new passphrase")).rejects.toMatchObject({ status: 401 });
  }, 30_000);
});
