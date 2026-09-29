import { toBase64 } from "../crypto/encoding";
import { api } from "./api";
import { deriveForAccount, deriveForNewPassword } from "./credentials";
import { e2ee } from "./e2ee";
import type { CredentialProof, User } from "./types";

// Key-derived sign-in (docs/e2ee-spec.md §1). The password never leaves the browser: Argon2id turns it into an
// authentication key, which is all the server receives, and a wrapping key, which stays on this page and protects the
// end-to-end encryption key.

export { MIN_PASSWORD_LENGTH, validateNewPassword } from "./credentials";

/** Sign-in, registration and password confirmation. Methods live on an object so tests can replace them. */
export const auth = {
  async signIn(username: string, password: string, rememberMe: boolean): Promise<User> {
    const { proof, keys } = await deriveForAccount(username, password);
    const user = await api.login({ username, rememberMe, ...proof });
    if (user.hasEndToEndKey) {
      // Unlock with the key already derived for signing in, so the password is asked only once. If this fails, the
      // unlock screen asks again.
      await e2ee.unlockWithWrapKey(user.id, keys.wrapKey).catch(() => undefined);
    }
    return user;
  },

  async register(username: string, password: string, displayName?: string): Promise<User> {
    const { kdf, keys } = await deriveForNewPassword(password);
    return api.register({ username, displayName, kdf, authKey: toBase64(keys.authKey) });
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
