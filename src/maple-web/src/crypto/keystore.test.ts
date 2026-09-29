// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptNote, encryptNote } from "./content";
import { importDataKey } from "./datakey";
import { randomBytes } from "./encoding";
import { forgetLocalKeys, loadLocalKey, saveLocalKey } from "./keystore";

const userId = "0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d";
const noteId = "0192f3a2-0000-7abc-8def-0123456789ab";

describe("keystore", () => {
  const raw = randomBytes(32);
  const sessionKey = randomBytes(32);

  beforeEach(() => forgetLocalKeys());

  it("restores the key within the same session", async () => {
    await saveLocalKey(userId, raw, 1, sessionKey);

    const keys = await loadLocalKey(userId, sessionKey);

    expect(keys).not.toBeNull();
    const envelope = await encryptNote(await importDataKey(raw), userId, noteId, "hello");
    expect(await decryptNote(keys!, userId, noteId, envelope)).toBe("hello");
  });

  it("is useless to another session, which deletes it", async () => {
    await saveLocalKey(userId, raw, 1, sessionKey);

    expect(await loadLocalKey(userId, randomBytes(32))).toBeNull();
    expect(await loadLocalKey(userId, sessionKey)).toBeNull(); // gone for good
  });

  it("is kept per account and forgotten on sign-out", async () => {
    await saveLocalKey(userId, raw, 1, sessionKey);

    expect(await loadLocalKey("0192f3a1-0000-7000-8000-000000000000", sessionKey)).toBeNull();
    await forgetLocalKeys();
    expect(await loadLocalKey(userId, sessionKey)).toBeNull();
  });
});
