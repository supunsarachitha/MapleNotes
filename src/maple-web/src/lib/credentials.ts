import { fromBase64, randomBytes, toBase64 } from "../crypto/encoding";
import { DEFAULT_KDF, deriveAccountKeys, validateKdf, type AccountKeys, type KdfParams } from "../crypto/kdf";
import { api, ApiError } from "./api";
import { hasWebCrypto } from "./secureContext";
import type { CredentialProof, KdfParamsWire } from "./types";

// Password → keys (docs/e2ee-spec.md §1). Shared by sign-in (auth.ts) and end-to-end key management (e2ee.ts).

export const MIN_PASSWORD_LENGTH = 10;

/** Rules for a new password, checked here because the server never sees it. Returns an error message or null. */
export function validateNewPassword(password: string): string | null {
  if (password.trim().length === 0 || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few random words make a strong, memorable password.`;
  }
  return null;
}

function fromWire(kdf: KdfParamsWire): KdfParams {
  return { salt: fromBase64(kdf.salt), memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism };
}

function toWire(kdf: KdfParams): KdfParamsWire {
  return { salt: toBase64(kdf.salt), memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism };
}

async function derive(password: string, kdf: KdfParams): Promise<AccountKeys> {
  try {
    validateKdf(kdf);
  } catch {
    // Weak parameters would make the key easier to crack; refuse them whoever sent them.
    throw new ApiError(0, { title: "The server asked for unsafe password settings, so nothing was sent." });
  }
  if (!hasWebCrypto()) {
    throw new ApiError(0, {
      title: "This page is not on a secure connection (HTTPS), so your browser cannot encrypt your password. Open Maple Notes over HTTPS.",
    });
  }
  try {
    return await deriveAccountKeys(password, kdf);
  } catch {
    throw new ApiError(0, {
      title: "Your browser could not prepare your password. Try again; if it keeps failing, close other tabs (this needs about 64 MB of memory).",
    });
  }
}

// The accounts this browser has signed in to with a derived key, as hashes of their usernames. A 1.0 account sends
// its password once, at its first sign-in, so that the server can switch it to key-derived sign-in; after that the
// server never needs the password again, and a request for it (prelogin's `upgrade`) is refused.
const KEY_DERIVED = "maple-notes:key-derived-accounts";

async function usernameHash(username: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(username.trim().toUpperCase()));
  return toBase64(new Uint8Array(digest));
}

function keyDerivedAccounts(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY_DERIVED) ?? "[]");
    return Array.isArray(stored) ? stored.filter((hash): hash is string => typeof hash === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers that an account signs in with a derived key, after a sign-in or registration that proved it. */
export async function rememberKeyDerived(username: string): Promise<void> {
  const hash = await usernameHash(username);
  const known = keyDerivedAccounts().filter((known) => known !== hash);
  try {
    localStorage.setItem(KEY_DERIVED, JSON.stringify([hash, ...known].slice(0, 50)));
  } catch {
    // storage unavailable: the check falls back to signed-in proofs only
  }
}

const refusedUpgrade = () =>
  new ApiError(0, { title: "The server asked for your password itself, which it does not need for this account, so nothing was sent." });

/**
 * The keys of an existing account, derived with its parameters from prelogin, and the proof to send. The password
 * itself is sent only to upgrade a 1.0 account at sign-in (`signingIn`), never while signed in, since signing in
 * upgrades the account, and never for an account this browser has signed in to with a derived key. Otherwise a server
 * could ask for the password at any time, and with it open an end-to-end key.
 */
export async function deriveForAccount(
  username: string,
  password: string,
  { signingIn = false }: { signingIn?: boolean } = {},
): Promise<{ proof: CredentialProof; keys: AccountKeys }> {
  const prelogin = await api.prelogin(username);
  if (prelogin.upgrade && (!signingIn || keyDerivedAccounts().includes(await usernameHash(username)))) throw refusedUpgrade();
  const keys = await derive(password, fromWire(prelogin.kdf));
  const authKey = toBase64(keys.authKey);
  // An account from before key-derived sign-in holds a hash of the password: send it once so the server can switch.
  return { keys, proof: prelogin.upgrade ? { authKey, password } : { authKey } };
}

/** Parameters (the defaults with a fresh random salt) and keys for a new password. */
export async function deriveForNewPassword(password: string): Promise<{ kdf: KdfParamsWire; keys: AccountKeys }> {
  const kdf = { ...DEFAULT_KDF, salt: randomBytes(16) };
  return { kdf: toWire(kdf), keys: await derive(password, kdf) };
}

/** The error the password fields show for a wrong password. */
export function wrongPassword(field = "password"): ApiError {
  return new ApiError(400, { errors: { [field]: ["The password is not correct."] } });
}
