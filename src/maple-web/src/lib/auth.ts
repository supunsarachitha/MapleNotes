import { toBase64 } from "../crypto/encoding";
import { api } from "./api";
import { isTwoFactorRequired } from "./apiError";
import { deriveForAccount, deriveForNewPassword, rememberKeyDerived } from "./credentials";
import { e2ee } from "./e2ee";
import { createPasskey, evaluatePasskey, getPasskey, PasskeyUnavailable } from "./passkeys";
import type { CredentialProof, Passkey, PasskeyCreationOptions, PasskeyRequestOptions, PasskeyUnlockKey, User } from "./types";

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

  /**
   * Signs in with a passkey. Pass `options` fetched beforehand when a tap starts this: Safari shows the passkey prompt
   * only right after a tap, so nothing slow should run in between. With `autofill`, waits until the person picks a
   * passkey from the username field's suggestions. End-to-end accounts are then unlocked on the unlock screen.
   */
  async signInWithPasskey(
    rememberMe: boolean,
    { options, autofill = false, signal }: { options?: PasskeyRequestOptions; autofill?: boolean; signal?: AbortSignal } = {},
  ): Promise<User> {
    const request = options ?? (await api.passkeys.signInOptions());
    const { credential, prfOutput } = await getPasskey(request, { autofill, signal });
    try {
      const { user, passkeyId, wrappedKey } = await api.passkeys.signIn({ challengeId: request.challengeId, credential, rememberMe });
      await rememberKeyDerived(user.username);
      if (user.hasEndToEndKey && wrappedKey && prfOutput) {
        // Unlocks too where the passkey can; otherwise, or if this fails, the unlock screen asks for the password.
        await e2ee.unlockWithPasskey(user, passkeyId, wrappedKey, prfOutput).catch(() => undefined);
      }
      return user;
    } finally {
      prfOutput?.fill(0);
    }
  },

  /**
   * Creates a passkey on this device with `options` fetched beforehand (so the prompt opens straight from the tap),
   * then proves the password and adds the passkey to the account.
   */
  async addPasskey(
    user: User,
    password: string,
    options: PasskeyCreationOptions,
    name?: string,
  ): Promise<{ passkey: Passkey; canUnlockWithTap: boolean }> {
    const created = await createPasskey(options);
    const { proof, keys } = await deriveForAccount(user.username, password);
    let passkey = await api.passkeys.add({ proof, challengeId: options.challengeId, credential: created.credential, ...(name ? { name } : {}) });
    const output = created.prf.output;
    if (user.hasEndToEndKey && output) {
      try {
        const wrapped = await e2ee.wrapForPasskey(user.id, keys.wrapKey, passkey.id, output);
        passkey = await api.passkeys.setUnlockKey(passkey.id, { proof, wrappedKey: toBase64(wrapped) });
      } finally {
        output.fill(0);
      }
    }
    // Some devices give the PRF output only when the passkey is used: one more tap sets up unlocking then.
    return { passkey, canUnlockWithTap: user.hasEndToEndKey && created.prf.enabled && !passkey.unlocksNotes };
  },

  /** Lets an existing passkey unlock the notes: asks it for its PRF output (one tap), then proves the password. */
  async enablePasskeyUnlock(user: User, password: string, passkey: Passkey): Promise<Passkey> {
    const { prfOutput } = await evaluatePasskey([passkey.credentialId]);
    try {
      const { proof, keys } = await deriveForAccount(user.username, password);
      const wrapped = await e2ee.wrapForPasskey(user.id, keys.wrapKey, passkey.id, prfOutput);
      return await api.passkeys.setUnlockKey(passkey.id, { proof, wrappedKey: toBase64(wrapped) });
    } finally {
      prfOutput.fill(0);
    }
  },

  /** Unlocks the notes with one of the account's passkeys that can (the unlock screen). */
  async unlockWithPasskey(user: User, unlockKeys: PasskeyUnlockKey[]): Promise<void> {
    const { id, prfOutput } = await evaluatePasskey(unlockKeys.map((key) => key.credentialId));
    try {
      const key = unlockKeys.find((candidate) => candidate.credentialId === id);
      if (!key) throw new PasskeyUnavailable("This passkey cannot unlock your notes. Use your password instead.");
      await e2ee.unlockWithPasskey(user, key.id, key.wrappedKey, prfOutput);
    } finally {
      prfOutput.fill(0);
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
