import { useState, type FormEvent } from "react";
import { AuthLayout, linkClass } from "../components/AuthLayout";
import { Button, ErrorMessage, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { e2ee } from "../lib/e2ee";
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
      </form>
    </AuthLayout>
  );
}
