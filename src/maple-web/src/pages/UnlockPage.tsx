import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthLayout, linkClass } from "../components/AuthLayout";
import { Button, ErrorMessage, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { PasskeyCancelled, passkeysSupported, PasskeyUnavailable } from "../lib/passkeys";
import { useSignedOut } from "../lib/queries";
import type { User } from "../lib/types";

/**
 * Asks for the password when this browser does not hold the account's end-to-end key: after the browser restarted
 * with "keep me signed in", or after its saved copy was cleared. Unlocking happens entirely in the browser.
 */
export function UnlockPage({ user }: { user: User }) {
  const signedOut = useSignedOut();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Passkeys that can unlock, fetched before the tap so the prompt opens straight from it.
  const unlockKeys = useQuery({
    queryKey: ["account", "passkeys", "unlock-keys"],
    queryFn: api.passkeys.unlockKeys,
    enabled: passkeysSupported(),
    retry: false,
  });

  async function unlockWithPasskey() {
    if (!unlockKeys.data?.length) return;
    setBusy(true);
    setError(null);
    try {
      await auth.unlockWithPasskey(user, unlockKeys.data);
    } catch (caught) {
      if (caught instanceof PasskeyCancelled) return;
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, { title: caught instanceof PasskeyUnavailable ? caught.message : "Something went wrong." }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await e2ee.unlock(user, password); // the app appears as soon as the key is unlocked
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      signedOut();
    }
  }

  const passwordError = error?.fieldError("password");

  return (
    <AuthLayout
      heading="Unlock your notes"
      intro={`Your notes are end-to-end encrypted. Enter your password to unlock them in this browser, @${user.username}.`}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            Forgot your password?{" "}
            <button type="button" className={linkClass} onClick={() => void signOut()}>
              Sign out
            </button>
            , then use your recovery key.
          </p>
        </div>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {error && !passwordError && <ErrorMessage>{error.message}</ErrorMessage>}
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={passwordError}
        />
        <Button type="submit" busy={busy} disabled={!password} className="mt-1 h-11">
          Unlock
        </Button>
        {passkeysSupported() && unlockKeys.data && unlockKeys.data.length > 0 && (
          <Button type="button" variant="secondary" disabled={busy} className="h-11" onClick={() => void unlockWithPasskey()}>
            <KeyRound className="size-4" aria-hidden="true" />
            Unlock with a passkey
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
