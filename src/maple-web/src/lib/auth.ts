import { fromBase64, randomBytes, toBase64 } from "../crypto/encoding";
import { DEFAULT_KDF, deriveAccountKeys, validateKdf, type AccountKeys, type KdfParams } from "../crypto/kdf";
import { api, ApiError } from "./api";
import type { CredentialProof, KdfParamsWire, User } from "./types";

// Key-derived sign-in (docs/e2ee-spec.md §1). The password never leaves the browser: Argon2id turns it into an
// authentication key, which is all the server receives, and a wrapping key, which stays on this page and protects the
// end-to-end encryption key.

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

/** Parameters for a new password: the defaults with a fresh random salt. */
function newKdf(): KdfParams {
  return { ...DEFAULT_KDF, salt: randomBytes(16) };
}

async function derive(password: string, kdf: KdfParams): Promise<AccountKeys> {
  try {
    validateKdf(kdf);
  } catch {
    // Weak parameters would make the key easier to crack; refuse them whoever sent them.
    throw new ApiError(0, { title: "The server asked for unsafe password settings, so nothing was sent." });
  }
  try {
    return await deriveAccountKeys(password, kdf);
  } catch {
    throw new ApiError(0, {
      title: "Your browser could not prepare your password (it needs about 64 MB of memory). Close other tabs and try again.",
    });
  }
}

/** Derives the proof of `password` for `username`, using the account's parameters from prelogin. */
async function proofFor(username: string, password: string): Promise<CredentialProof> {
  const prelogin = await api.prelogin(username);
  const keys = await derive(password, fromWire(prelogin.kdf));
  // An account from before key-derived sign-in holds a hash of the password: send it once so the server can switch.
  return prelogin.upgrade ? { authKey: toBase64(keys.authKey), password } : { authKey: toBase64(keys.authKey) };
}

/** Sign-in, registration and password confirmation. Methods live on an object so tests can replace them. */
export const auth = {
  async signIn(username: string, password: string, rememberMe: boolean): Promise<User> {
    const proof = await proofFor(username, password);
    return api.login({ username, rememberMe, ...proof });
  },

  async register(username: string, password: string, displayName?: string): Promise<User> {
    const kdf = newKdf();
    const keys = await derive(password, kdf);
    return api.register({ username, displayName, kdf: toWire(kdf), authKey: toBase64(keys.authKey) });
  },

  /** Proof of the password for a security-relevant change (encryption settings, deleting the account). */
  proveIdentity: (username: string, password: string): Promise<CredentialProof> => proofFor(username, password),

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    const current = await proofFor(username, currentPassword);
    const kdf = newKdf();
    const keys = await derive(newPassword, kdf);
    await api.changePassword({ current, newKdf: toWire(kdf), newAuthKey: toBase64(keys.authKey) });
  },
};
