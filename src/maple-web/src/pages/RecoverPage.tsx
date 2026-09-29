import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AuthLayout, linkClass } from "../components/AuthLayout";
import { RecoveryKit } from "../components/RecoveryKit";
import { Button, ErrorMessage, TextField } from "../components/ui";
import { ApiError } from "../lib/api";
import { MIN_PASSWORD_LENGTH } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { queryKeys } from "../lib/queries";
import { Link, navigate } from "../lib/router";

/**
 * Sets a new password with the recovery key of an end-to-end encrypted account. The browser unwraps the notes' key
 * with the recovery key and wraps it again for the new password, so nothing is lost. The used recovery key is retired
 * and a new one is shown.
 */
export function RecoverPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ username: string; recoveryKey: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const recovered = await e2ee.recover(username, recoveryKey, newPassword);
      setResult({ username: recovered.user.username, recoveryKey: recovered.recoveryKey });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    navigate("/", { replace: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }

  if (result) {
    return (
      <AuthLayout heading="Your new recovery key" intro="Your password is reset. The recovery key you used no longer works.">
        <RecoveryKit recoveryKey={result.recoveryKey} username={result.username} confirmLabel="Continue to my notes" onConfirmed={done} />
      </AuthLayout>
    );
  }

  const fieldErrors = ["username", "recoveryKey", "newPassword"].some((field) => error?.fieldError(field));

  return (
    <AuthLayout
      heading="Reset your password"
      intro="Accounts with end-to-end encryption can set a new password with their recovery key. Maple Notes has no other way to reset a forgotten password."
      footer={
        <Link href="/login" className={linkClass}>
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {error && !fieldErrors && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={error?.fieldError("username")}
        />
        <TextField
          label="Recovery key"
          name="recoveryKey"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          className="[&_input]:font-mono"
          value={recoveryKey}
          onChange={(event) => setRecoveryKey(event.target.value)}
          error={error?.fieldError("recoveryKey")}
          hint="52 characters, as saved when you turned on end-to-end encryption. Dashes and spaces are optional."
        />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={error?.fieldError("newPassword")}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <Button type="submit" busy={busy} className="mt-1 h-11">
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
