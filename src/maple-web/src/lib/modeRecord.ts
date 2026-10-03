import { createContext, useContext, useEffect, useState } from "react";
import { openModeRecord, sealModeRecord, type ModeRecord } from "../crypto/content";
import type { DataKeys } from "../crypto/datakey";
import { fromBase64, toBase64 } from "../crypto/encoding";
import type { KeyState } from "./e2ee";
import type { EncryptionMode, User } from "./types";

// The sealed mode record (docs/e2ee-spec.md §3a). Whether a browser holding an account's end-to-end key may decrypt
// content, and send new content, for a mode without end-to-end encryption is decided by this record, which a browser
// sealed with that key when the owner changed the mode, not by the mode the server reports: the server cannot forge
// the record, so it cannot make the account's browsers give up end-to-end encryption. Each browser remembers the
// newest record it has seen, so an older one (from before the owner switched back) is not accepted again either.

const STORAGE_PREFIX = "maple-notes:e2ee-mode:";

interface Remembered {
  epoch: number;
  mode: EncryptionMode;
}

function remembered(userId: string): Remembered | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) ?? "null") as Partial<Remembered> | null;
    return value && Number.isSafeInteger(value.epoch) && typeof value.mode === "string" ? (value as Remembered) : null;
  } catch {
    return null;
  }
}

function remember(userId: string, record: ModeRecord): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify({ epoch: record.epoch, mode: record.mode }));
  } catch {
    // storage unavailable: rollbacks are then only caught within this page
  }
}

/** Forgets what this browser remembered of the account's mode (after its owner confirms they left end-to-end). */
export function forgetMode(userId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + userId);
  } catch {
    // nothing remembered
  }
}

export interface TrustedMode {
  /** The mode this browser encrypts and converts for. */
  mode: EncryptionMode;
  /**
   * `unconfirmed`: the server reports a mode without end-to-end encryption that no record from the owner confirms, so
   * this browser keeps encrypting. `key-missing`: the server says the account has no end-to-end key, although this
   * browser last saw it in end-to-end mode.
   */
  warning: "unconfirmed" | "key-missing" | null;
}

async function openRecord(user: User, keys: DataKeys): Promise<ModeRecord | null> {
  if (!user.endToEndModeRecord) return null;
  try {
    return await openModeRecord(keys, user.id, fromBase64(user.endToEndModeRecord));
  } catch {
    return null; // forged, damaged or for another account
  }
}

/** Decides which mode this browser trusts for the account (see the comment at the top). */
export async function trustMode(user: User, keys: DataKeys | null): Promise<TrustedMode> {
  const last = remembered(user.id);
  if (!keys) {
    const vanished = !user.hasEndToEndKey && last?.mode === "EndToEnd";
    return { mode: user.encryptionMode, warning: vanished ? "key-missing" : null };
  }
  const record = await openRecord(user, keys);
  if (record && (!last || record.epoch >= last.epoch)) {
    remember(user.id, record);
    if (record.mode === user.encryptionMode) return { mode: record.mode, warning: null };
  }
  // No record of the owner's, an older one than this browser has seen, or one that disagrees with the server: keep
  // end-to-end encryption.
  return { mode: "EndToEnd", warning: user.encryptionMode === "EndToEnd" ? null : "unconfirmed" };
}

/** The record to send with a change of mode: the new mode, sealed, with a counter above any seen before. */
export async function sealNextMode(user: User, keys: DataKeys, mode: EncryptionMode): Promise<string> {
  const current = await openRecord(user, keys);
  const epoch = Math.max(current?.epoch ?? 0, remembered(user.id)?.epoch ?? 0) + 1;
  return toBase64(await sealModeRecord(keys, user.id, { mode, epoch }));
}

/** The mode an account starts with when it turns on end-to-end encryption. */
export async function sealFirstMode(user: User, keys: DataKeys): Promise<string> {
  const epoch = (remembered(user.id)?.epoch ?? 0) + 1;
  return toBase64(await sealModeRecord(keys, user.id, { mode: "EndToEnd", epoch }));
}

/**
 * The mode this browser trusts for the signed-in account, checked again whenever the account or its key changes.
 * Until the check finishes, a browser holding the key assumes end-to-end mode.
 */
export function useTrustedMode(user: User | null, keyState: KeyState): TrustedMode | null {
  const keys = keyState.status === "unlocked" ? keyState.keys : null;
  const key = user ? [user.id, user.encryptionMode, user.hasEndToEndKey, user.endToEndModeRecord ?? "", keys ? 1 : 0].join("|") : "";
  const [checked, setChecked] = useState<{ key: string; trusted: TrustedMode } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void trustMode(user, keys).then((trusted) => !cancelled && setChecked({ key, trusted }));
    return () => {
      cancelled = true;
    };
    // The key lists everything the check depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!user) return null;
  if (checked?.key === key) return checked.trusted;
  return { mode: keys ? "EndToEnd" : user.encryptionMode, warning: null };
}

/** The trusted mode of the signed-in account, for components below the app shell. */
export const TrustedModeContext = createContext<TrustedMode | null>(null);

export function useTrustedModeContext(): TrustedMode | null {
  return useContext(TrustedModeContext);
}
