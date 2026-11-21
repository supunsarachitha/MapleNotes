import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { auth } from "./auth";
import { e2ee } from "./e2ee";
import * as passkeys from "./passkeys";
import { DEFAULT_PREFERENCES } from "./preferences";
import type { User } from "./types";
import type { Bytes } from "../crypto/encoding";

vi.mock("./passkeys", async (importOriginal) => ({ ...(await importOriginal<typeof import("./passkeys")>()), getPasskey: vi.fn() }));

// Signing in with a passkey on an end-to-end account: when the notes stay locked, the unlock screen is told why.

const user: User = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "maple",
  displayName: "maple",
  role: "User",
  encryptionMode: "EndToEnd",
  hasEndToEndKey: true,
  createdAtUtc: "",
  preferences: DEFAULT_PREFERENCES,
};
const options = { challengeId: "c1", challenge: "AA==", rpId: "localhost", timeoutMs: 60_000 };
const credential = { id: "AQ==", clientDataJson: "", authenticatorData: "", signature: "", userHandle: null };

function signInAnswers(wrappedKey: string | null, prfOutput: Bytes | null) {
  vi.mocked(passkeys.getPasskey).mockResolvedValue({ credential, prfOutput });
  vi.spyOn(api.passkeys, "signIn").mockResolvedValue({ user, passkeyId: "p1", wrappedKey });
}

describe("passkey sign-in on an end-to-end account", () => {
  beforeEach(() => passkeys.setPasskeyUnlockMiss("left over"));
  afterEach(() => vi.restoreAllMocks());

  it("unlocks and notes nothing when the passkey can unlock", async () => {
    signInAnswers("d3JhcHBlZA==", new Uint8Array(32));
    const unlock = vi.spyOn(e2ee, "unlockWithPasskey").mockResolvedValue({} as never);
    await auth.signInWithPasskey(false, { options });
    expect(unlock).toHaveBeenCalled();
    expect(passkeys.passkeyUnlockMiss()).toBeNull();
  });

  it("says the passkey manager gave no PRF output (Bitwarden)", async () => {
    signInAnswers("d3JhcHBlZA==", null);
    const unlock = vi.spyOn(e2ee, "unlockWithPasskey");
    await auth.signInWithPasskey(false, { options });
    expect(unlock).not.toHaveBeenCalled();
    expect(passkeys.passkeyUnlockMiss()).toBe(passkeys.NO_PRF_MESSAGE);
  });

  it("says the passkey is not set up to unlock", async () => {
    signInAnswers(null, new Uint8Array(32));
    await auth.signInWithPasskey(false, { options });
    expect(passkeys.passkeyUnlockMiss()).toBe(passkeys.NOT_SET_UP_MESSAGE);
  });

  it("passes on why the stored key did not open", async () => {
    signInAnswers("d3JhcHBlZA==", new Uint8Array(32));
    vi.spyOn(e2ee, "unlockWithPasskey").mockRejectedValue(new passkeys.PasskeyUnavailable("Key did not open."));
    await auth.signInWithPasskey(false, { options });
    expect(passkeys.passkeyUnlockMiss()).toBe("Key did not open.");
  });
});
