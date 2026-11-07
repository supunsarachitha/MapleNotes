// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealModeRecord } from "../crypto/content";
import { importDataKey, unwrapRawDataKey } from "../crypto/datakey";
import { fromBase64, randomBytes, toBase64 } from "../crypto/encoding";
import { importAesKey } from "../crypto/kdf";
import { passkeyContext, passkeyWrapKey } from "../crypto/passkey";
import v from "../crypto/test-vectors.json";
import { api } from "./api";
import { e2ee } from "./e2ee";
import { PasskeyUnavailable } from "./passkeys";
import { DEFAULT_PREFERENCES } from "./preferences";
import type { User } from "./types";

// Unlocking end-to-end notes with a passkey's PRF output (docs/e2ee-spec.md §6a), with the shared test vectors.

const user: User = {
  id: v.ids.userId,
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: "EndToEnd",
  hasEndToEndKey: true,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
};
const passkeyId = v.passkey.passkeyId;
const prf = () => fromBase64(v.passkey.prfOutputB64);

beforeEach(() => {
  vi.spyOn(api.e2ee, "key").mockResolvedValue({ wrappedKey: v.wrappedDataKey.envelopeB64 });
  vi.spyOn(api, "sessionKey").mockResolvedValue({ key: toBase64(randomBytes(32)) });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await e2ee.forget();
});

describe("passkey unlock", () => {
  it("wraps the account's data key for a passkey, and only that passkey opens it", async () => {
    const wrapped = await e2ee.wrapForPasskey(user.id, await importAesKey(fromBase64(v.kdf.wrapKeyB64)), passkeyId, prf());

    const back = await unwrapRawDataKey(await passkeyWrapKey(prf()), wrapped, passkeyContext(user.id, passkeyId));
    expect(toBase64(back.raw)).toBe(v.dataKeyB64);
    await expect(
      unwrapRawDataKey(await passkeyWrapKey(randomBytes(32)), wrapped, passkeyContext(user.id, passkeyId)),
    ).rejects.toThrow();
  });

  it("unlocks with the vectors' wrapped key and keeps it unlocked", async () => {
    const keys = await e2ee.unlockWithPasskey(user, passkeyId, v.passkey.wrappedDataKeyB64, prf());

    expect(e2ee.keysFor(user.id)).toBe(keys);
  });

  it("refuses a wrapped key for another passkey, or one that does not open the mode record", async () => {
    await expect(e2ee.unlockWithPasskey(user, v.ids.noteId, v.passkey.wrappedDataKeyB64, prf())).rejects.toBeInstanceOf(PasskeyUnavailable);

    // A key the server substituted: wrapped correctly for the passkey, but not the key that sealed the mode record.
    const real = await importDataKey(fromBase64(v.dataKeyB64));
    const record = toBase64(await sealModeRecord(real, user.id, { mode: "EndToEnd", epoch: 1 }));
    const substitute = randomBytes(32);
    const { seal } = await import("../crypto/envelope");
    const forged = toBase64(await seal(await passkeyWrapKey(prf()), substitute, passkeyContext(user.id, passkeyId), { keyVersion: 1 }));

    await expect(e2ee.unlockWithPasskey({ ...user, endToEndModeRecord: record }, passkeyId, forged, prf())).rejects.toThrow(
      "not your account's key",
    );
    expect(e2ee.keysFor(user.id)).toBeNull();
    await expect(e2ee.unlockWithPasskey({ ...user, endToEndModeRecord: record }, passkeyId, v.passkey.wrappedDataKeyB64, prf())).resolves.toBeDefined();
  });
});
