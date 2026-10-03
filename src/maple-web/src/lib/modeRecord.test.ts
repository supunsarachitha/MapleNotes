import { afterEach, describe, expect, it } from "vitest";
import { openModeRecord, sealModeRecord, type ModeRecord } from "../crypto/content";
import { generateDataKey, importDataKey, type DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import { forgetMode, sealFirstMode, sealNextMode, trustMode } from "./modeRecord";
import { DEFAULT_PREFERENCES } from "./preferences";
import type { EncryptionMode, User } from "./types";

// Which mode a browser holding the end-to-end key trusts: the owner's sealed record, never the server's word alone.

const account = (mode: EncryptionMode, record: string | null = null, hasEndToEndKey = true): User => ({
  id: "0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d",
  username: "maple",
  displayName: "Maple",
  role: "User",
  encryptionMode: mode,
  hasEndToEndKey,
  createdAtUtc: "2026-09-28T12:00:00Z",
  preferences: DEFAULT_PREFERENCES,
  endToEndModeRecord: record,
});

const userId = account("EndToEnd").id;
const sealed = async (keys: DataKeys, record: ModeRecord) => toBase64(await sealModeRecord(keys, userId, record));

afterEach(() => localStorage.clear());

describe("the mode a browser trusts", () => {
  it("follows the server out of end-to-end encryption only when the owner's record says so", async () => {
    const keys = await importDataKey(generateDataKey());

    expect(await trustMode(account("AtRest", await sealed(keys, { mode: "AtRest", epoch: 2 })), keys)).toEqual({ mode: "AtRest", warning: null });
    expect(await trustMode(account("EndToEnd"), keys)).toEqual({ mode: "EndToEnd", warning: null }); // accounts from before records
  });

  it("keeps encrypting when the server's mode has no record, a forged one, or one that disagrees", async () => {
    const keys = await importDataKey(generateDataKey());
    const otherKey = await importDataKey(generateDataKey());
    const keep = { mode: "EndToEnd", warning: "unconfirmed" };

    expect(await trustMode(account("AtRest"), keys)).toEqual(keep);
    expect(await trustMode(account("Off", await sealed(otherKey, { mode: "Off", epoch: 9 })), keys)).toEqual(keep);
    expect(await trustMode(account("Off", await sealed(keys, { mode: "AtRest", epoch: 2 })), keys)).toEqual(keep);
    expect(await trustMode(account("AtRest", toBase64(new Uint8Array(60))), keys)).toEqual(keep);
  });

  it("refuses an older record once it has seen a newer one", async () => {
    const keys = await importDataKey(generateDataKey());
    const leave = await sealed(keys, { mode: "AtRest", epoch: 2 });
    await trustMode(account("EndToEnd", await sealed(keys, { mode: "EndToEnd", epoch: 3 })), keys); // the owner switched back

    // The server replays the record from before the switch back.
    expect(await trustMode(account("AtRest", leave), keys)).toEqual({ mode: "EndToEnd", warning: "unconfirmed" });
  });

  it("stops when the key vanishes from an account this browser last saw end-to-end", async () => {
    const keys = await importDataKey(generateDataKey());
    await trustMode(account("EndToEnd", await sealed(keys, { mode: "EndToEnd", epoch: 1 })), keys);

    expect(await trustMode(account("AtRest", null, false), null)).toEqual({ mode: "AtRest", warning: "key-missing" });
    forgetMode(userId); // the owner confirms they turned it off
    expect(await trustMode(account("AtRest", null, false), null)).toEqual({ mode: "AtRest", warning: null });
  });

  it("lets the key go quietly when this browser saw the owner leave", async () => {
    const keys = await importDataKey(generateDataKey());
    await trustMode(account("AtRest", await sealed(keys, { mode: "AtRest", epoch: 2 })), keys);

    expect(await trustMode(account("AtRest", null, false), null)).toEqual({ mode: "AtRest", warning: null });
  });

  it("seals each change with a counter above every one seen", async () => {
    const keys = await importDataKey(generateDataKey());
    await trustMode(account("EndToEnd", await sealed(keys, { mode: "EndToEnd", epoch: 4 })), keys);

    const next = await sealNextMode(account("EndToEnd", await sealed(keys, { mode: "EndToEnd", epoch: 2 })), keys, "Off");
    const first = await sealFirstMode(account("AtRest", null, false), keys);

    expect(await openModeRecord(keys, userId, fromBase64(next))).toEqual({ mode: "Off", epoch: 5 });
    expect(await openModeRecord(keys, userId, fromBase64(first))).toEqual({ mode: "EndToEnd", epoch: 5 });
  });
});
