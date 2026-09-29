import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import { e2ee } from "../lib/e2ee";
import type { User } from "../lib/types";
import { RecoveryKit } from "./RecoveryKit";
import { Button, ErrorMessage, TextField } from "./ui";

/**
 * Turns on end-to-end encryption: explains what changes, asks for an explicit acknowledgement and the password, then
 * shows the recovery key once. The dialog cannot be dismissed while the key is on screen.
 */
export function EndToEndSetupDialog({ user, open, onClose }: { user: User; open: boolean; onClose: (enabled: boolean) => void }) {
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  function reset() {
    setUnderstood(false);
    setPassword("");
    setError(null);
    setRecoveryKey(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRecoveryKey((await e2ee.setUp(user, password)).recoveryKey);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const passwordError = error?.fieldError("password");
  const showingKey = recoveryKey !== null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next || showingKey) return;
        reset();
        onClose(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(event) => showingKey && event.preventDefault()}
          onPointerDownOutside={(event) => showingKey && event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900"
        >
          {showingKey ? (
            <>
              <Dialog.Title className="mb-3 text-lg font-semibold">Save your recovery key</Dialog.Title>
              <Dialog.Description className="sr-only">Your recovery key, shown only once.</Dialog.Description>
              <RecoveryKit
                recoveryKey={recoveryKey}
                username={user.username}
                confirmLabel="Done"
                onConfirmed={() => {
                  reset();
                  onClose(true);
                }}
              />
            </>
          ) : (
            <>
              <Dialog.Title className="text-lg font-semibold">Turn on end-to-end encryption?</Dialog.Title>
              <Dialog.Description asChild>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-stone-600 dark:text-stone-300">
                  <li>Your notes, tags and files are encrypted in this browser. The server stores them but cannot read them.</li>
                  <li>
                    You get a recovery key. It is the only way to reset a forgotten password: an administrator cannot
                    recover your notes.
                  </li>
                  <li>
                    Search, tags and export run in your browser. Your existing notes are encrypted here, so keep Maple Notes
                    open until that finishes.
                  </li>
                </ul>
              </Dialog.Description>
              <form onSubmit={(event) => void submit(event)} className="mt-5 flex flex-col gap-4">
                {error && !passwordError && <ErrorMessage>{error.message}</ErrorMessage>}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(event) => setUnderstood(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-maple-600"
                  />
                  I understand that without my password or my recovery key, my notes cannot be recovered.
                </label>
                <TextField
                  label="Your password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={passwordError}
                />
                <div className="flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost">Cancel</Button>
                  </Dialog.Close>
                  <Button type="submit" busy={busy} disabled={!understood || !password}>
                    Turn on
                  </Button>
                </div>
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
