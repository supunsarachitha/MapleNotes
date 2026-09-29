import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DATA_KEY_VERSION,
  dataKeyContext,
  generateDataKey,
  importDataKey,
  recoveryContext,
  unwrapRawDataKey,
  wrapDataKey,
  type DataKeys,
} from "../crypto/datakey";
import { fromBase64, toBase64, type Bytes } from "../crypto/encoding";
import { DecryptionError } from "../crypto/envelope";
import { forgetLocalKeys, loadLocalKey, saveLocalKey } from "../crypto/keystore";
import { deriveRecoveryKeys, formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from "../crypto/recovery";
import { api, ApiError } from "./api";
import { deriveForAccount, deriveForNewPassword, validateNewPassword, wrongPassword } from "./credentials";
import { shareKeysWithMediaWorker } from "./mediaWorker";
import type { EncryptionStatus, User } from "./types";

// End-to-end key management in the browser (docs/e2ee-spec.md §3, §6, §7). The data key is created here and reaches
// the server only wrapped: once with the key derived from the password, once with the recovery key. While the app is
// open, the unlocked key is held as non-extractable CryptoKeys; between page loads, crypto/keystore.ts keeps it
// sealed under the session's secret.

export interface Unlocked {
  userId: string;
  keys: DataKeys;
}

let unlocked: Unlocked | null = null;
const listeners = new Set<() => void>();

function publish(next: Unlocked | null): void {
  unlocked = next;
  shareKeysWithMediaWorker(next); // the media service worker decrypts files with the same key
  listeners.forEach((listener) => listener());
}

async function sessionKey(): Promise<Bytes> {
  return fromBase64((await api.sessionKey()).key);
}

/** Keeps a raw data key unlocked for this page and saved for this session, then wipes `raw`. */
async function adopt(userId: string, raw: Bytes, version: number): Promise<DataKeys> {
  try {
    const keys = await importDataKey(raw, version);
    try {
      await saveLocalKey(userId, raw, version, await sessionKey());
    } catch {
      // No IndexedDB (for example some private windows): the key stays unlocked for this page only.
    }
    publish({ userId, keys });
    return keys;
  } finally {
    raw.fill(0);
  }
}

/** Wraps `raw` and checks that the result opens again before it is sent: the server cannot check what it stores. */
async function wrapChecked(wrapKey: CryptoKey, raw: Uint8Array, context: string): Promise<Bytes> {
  const wrapped = await wrapDataKey(wrapKey, raw, context);
  const back = await unwrapRawDataKey(wrapKey, wrapped, context);
  const same = back.raw.length === raw.length && back.raw.every((byte, i) => byte === raw[i]);
  back.raw.fill(0);
  if (!same) throw new Error("The encryption key could not be wrapped correctly; nothing was changed.");
  return wrapped;
}

/** Fetches the account's wrapped key and unwraps it; a key that does not open means the password was wrong. */
async function unwrapAccountKey(userId: string, wrapKey: CryptoKey, field: string): Promise<{ raw: Bytes; version: number }> {
  const { wrappedKey } = await api.e2ee.key();
  try {
    return await unwrapRawDataKey(wrapKey, fromBase64(wrappedKey), dataKeyContext(userId));
  } catch (error) {
    throw error instanceof DecryptionError ? wrongPassword(field) : error;
  }
}

export const e2ee = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The unlocked key of this page, if any. */
  snapshot: (): Unlocked | null => unlocked,

  /** The unlocked keys of `userId`, or null while locked. */
  keysFor: (userId: string): DataKeys | null => (unlocked?.userId === userId ? unlocked.keys : null),

  /** Restores the key this browser saved during the current session; null when there is none. */
  async restore(userId: string): Promise<DataKeys | null> {
    if (unlocked?.userId === userId) return unlocked.keys;
    const keys = await loadLocalKey(userId, await sessionKey()).catch(() => null);
    if (keys) publish({ userId, keys });
    return keys;
  },

  /** Unlocks with a wrapping key the caller already derived (sign-in derives one anyway). */
  async unlockWithWrapKey(userId: string, wrapKey: CryptoKey): Promise<DataKeys> {
    const { raw, version } = await unwrapAccountKey(userId, wrapKey, "password");
    return adopt(userId, raw, version);
  },

  /** Unlocks with the password (the unlock screen). */
  async unlock(user: User, password: string): Promise<DataKeys> {
    const { keys } = await deriveForAccount(user.username, password);
    return e2ee.unlockWithWrapKey(user.id, keys.wrapKey);
  },

  /** Re-wraps the data key from the current password's wrapping key to a new password's. */
  async rewrap(userId: string, currentWrapKey: CryptoKey, newWrapKey: CryptoKey, field = "password"): Promise<Bytes> {
    const { raw } = await unwrapAccountKey(userId, currentWrapKey, field);
    try {
      return await wrapChecked(newWrapKey, raw, dataKeyContext(userId));
    } finally {
      raw.fill(0);
    }
  },

  /**
   * Switches the account to end-to-end encryption with a new data key and recovery key. Returns the recovery key to
   * show once, formatted for reading.
   */
  async setUp(user: User, password: string): Promise<{ recoveryKey: string; status: EncryptionStatus }> {
    const { proof, keys } = await deriveForAccount(user.username, password);
    const raw = generateDataKey();
    const recoveryKey = generateRecoveryKey();
    try {
      const recovery = await deriveRecoveryKeys(recoveryKey);
      const status = await api.e2ee.enable({
        proof,
        wrappedKey: toBase64(await wrapChecked(keys.wrapKey, raw, dataKeyContext(user.id))),
        recoveryWrappedKey: toBase64(await wrapChecked(recovery.wrapKey, raw, recoveryContext(user.id))),
        recoveryAuthKey: toBase64(recovery.authKey),
      });
      const formatted = formatRecoveryKey(recoveryKey);
      await adopt(user.id, raw, DATA_KEY_VERSION);
      return { recoveryKey: formatted, status };
    } finally {
      raw.fill(0);
      recoveryKey.fill(0);
    }
  },

  /** Replaces the recovery key; the old one stops working. Returns the new one, formatted for reading. */
  async replaceRecoveryKey(user: User, password: string): Promise<string> {
    const { proof, keys } = await deriveForAccount(user.username, password);
    const { raw } = await unwrapAccountKey(user.id, keys.wrapKey, "password");
    const recoveryKey = generateRecoveryKey();
    try {
      const recovery = await deriveRecoveryKeys(recoveryKey);
      await api.e2ee.replaceRecoveryKey({
        proof,
        recoveryWrappedKey: toBase64(await wrapChecked(recovery.wrapKey, raw, recoveryContext(user.id))),
        recoveryAuthKey: toBase64(recovery.authKey),
      });
      return formatRecoveryKey(recoveryKey);
    } finally {
      raw.fill(0);
      recoveryKey.fill(0);
    }
  },

  /**
   * Sets a new password with the recovery key and signs in. The used recovery key is retired and a new one is
   * returned, to show once.
   */
  async recover(username: string, recoveryKeyText: string, newPassword: string): Promise<{ user: User; recoveryKey: string }> {
    const weakPassword = validateNewPassword(newPassword);
    if (weakPassword) throw new ApiError(400, { errors: { newPassword: [weakPassword] } });
    let oldKey: Bytes;
    try {
      oldKey = parseRecoveryKey(recoveryKeyText);
    } catch (error) {
      throw new ApiError(400, { errors: { recoveryKey: [error instanceof Error ? error.message : "This is not a recovery key."] } });
    }
    const old = await deriveRecoveryKeys(oldKey);
    oldKey.fill(0);
    const recoveryAuthKey = toBase64(old.authKey);
    const { userId, recoveryWrappedKey } = await api.recovery.key(username, recoveryAuthKey);
    const { raw, version } = await unwrapRawDataKey(old.wrapKey, fromBase64(recoveryWrappedKey), recoveryContext(userId));
    const newRecoveryKey = generateRecoveryKey();
    try {
      const next = await deriveForNewPassword(newPassword);
      const newRecovery = await deriveRecoveryKeys(newRecoveryKey);
      const user = await api.recovery.reset({
        username,
        recoveryAuthKey,
        newKdf: next.kdf,
        newAuthKey: toBase64(next.keys.authKey),
        newWrappedKey: toBase64(await wrapChecked(next.keys.wrapKey, raw, dataKeyContext(userId))),
        newRecoveryWrappedKey: toBase64(await wrapChecked(newRecovery.wrapKey, raw, recoveryContext(userId))),
        newRecoveryAuthKey: toBase64(newRecovery.authKey),
      });
      const recoveryKey = formatRecoveryKey(newRecoveryKey);
      await adopt(userId, raw, version); // signed in now, so this session has a secret to save the key under
      return { user, recoveryKey };
    } finally {
      raw.fill(0);
      newRecoveryKey.fill(0);
    }
  },

  /** Forgets the unlocked key on this page only; the copy saved for this session stays (as after a reload). */
  lock(): void {
    publish(null);
  },

  /** Forgets the unlocked key on this page and in this browser (sign-out). */
  async forget(): Promise<void> {
    publish(null);
    await forgetLocalKeys().catch(() => undefined);
  },
};

export type KeyState =
  | { status: "not-needed" }
  | { status: "checking" }
  | { status: "locked" }
  | { status: "unlocked"; keys: DataKeys };

/**
 * Whether this browser holds the user's end-to-end key. On first use it tries the copy saved during this session;
 * "locked" means the password is needed.
 */
export function useEndToEndKeys(user: User | null): KeyState {
  const current = useSyncExternalStore(e2ee.subscribe, e2ee.snapshot);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const needsKey = user?.hasEndToEndKey === true;
  const userId = user?.id;
  const holdsKey = current !== null && current.userId === userId;

  useEffect(() => {
    if (!needsKey || !userId || holdsKey) return;
    let cancelled = false;
    void e2ee.restore(userId).finally(() => !cancelled && setRestoredFor(userId));
    return () => {
      cancelled = true;
    };
  }, [needsKey, userId, holdsKey]);

  if (!needsKey) return { status: "not-needed" };
  if (holdsKey) return { status: "unlocked", keys: current.keys };
  return restoredFor === userId ? { status: "locked" } : { status: "checking" };
}
