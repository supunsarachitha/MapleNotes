import { toBase64 } from "../crypto/encoding";
import { api } from "./api";
import { isTwoFactorRequired } from "./apiError";
import { deriveForAccount, deriveForNewPassword, rememberKeyDerived } from "./credentials";
import { e2ee } from "./e2ee";
import type { CredentialProof, User } from "./types";

// Key-derived sign-in (docs/e2ee-spec.md §1). The password never leaves the browser: Argon2id turns it into an
// authentication key, which is all the server receives, and a wrapping key, which stays on this page and protects the
// end-to-end encryption key.

export { MIN_PASSWORD_LENGTH, validateNewPassword } from "./credentials";

/**
 * Thrown by sign-in when the password is right and the account also needs a code from its authenticator app.
 * `complete` signs in with the code, reusing the keys already derived, so the slow derivation does not run again.
 */
export class TwoFactorRequired extends Error {
  constructor(readonly complete: (code: string) => Promise<User>) {
    super("Enter the code from your authenticator app.");
    this.name = "TwoFactorRequired";
  }
}

/** Sign-in, registration and password confirmation. Methods live on an object so tests can replace them. */
export const auth = {
  /** Signs in; throws {@link TwoFactorRequired} when the account also needs a two-factor code. */
  async signIn(username: string, password: string, rememberMe: boolean): Promise<User> {
    const { proof, keys } = await deriveForAccount(username, password, { signingIn: true });
    const finish = async (twoFactorCode?: string) => {
      const user = await api.login({ username, rememberMe, ...proof, ...(twoFactorCode ? { twoFactorCode } : {}) });
      await rememberKeyDerived(username);
      if (user.hasEndToEndKey) {
        // Unlock with the key already derived for signing in, so the password is asked only once. If this fails, the
        // unlock screen asks again.
        await e2ee.unlockWithWrapKey(user.id, keys.wrapKey).catch(() => undefined);
      }
      return user;
    };
    try {
      return await finish();
    } catch (error) {
      if (isTwoFactorRequired(error)) throw new TwoFactorRequired((code) => finish(code.trim()));
      throw error;
    }
  },

  async register(username: string, password: string, displayName?: string): Promise<User> {
    const { kdf, keys } = await deriveForNewPassword(password);
    const user = await api.register({ username, displayName, kdf, authKey: toBase64(keys.authKey) });
    await rememberKeyDerived(username);
    return user;
  },

  /** Proof of the password for a security-relevant change (encryption settings, deleting the account). */
  proveIdentity: async (username: string, password: string): Promise<CredentialProof> =>
    (await deriveForAccount(username, password)).proof,

  /** Changes the password; an end-to-end key is re-wrapped for the new password on the way. */
  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    const current = await deriveForAccount(user.username, currentPassword);
    const next = await deriveForNewPassword(newPassword);
    const newWrappedKey = user.hasEndToEndKey
      ? toBase64(await e2ee.rewrap(user.id, current.keys.wrapKey, next.keys.wrapKey, "currentPassword"))
      : undefined;
    await api.changePassword({
      current: current.proof,
      newKdf: next.kdf,
      newAuthKey: toBase64(next.keys.authKey),
      ...(newWrappedKey ? { newWrappedKey } : {}),
    });
  },
};
