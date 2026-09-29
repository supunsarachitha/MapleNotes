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

/** The keys of an existing account, derived with its parameters from prelogin, and the proof to send. */
export async function deriveForAccount(username: string, password: string): Promise<{ proof: CredentialProof; keys: AccountKeys }> {
  const prelogin = await api.prelogin(username);
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
