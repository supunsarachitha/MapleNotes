import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { setConfirmer } from "../lib/confirmation";
import { getPasskey, PasskeyCancelled, passkeysSupported } from "../lib/passkeys";
import type { PasskeyRequestOptions, User } from "../lib/types";
import { passkeysKey } from "./PasskeysSection";
import { Button, ErrorMessage, TextField } from "./ui";

type Method = "password" | "code";

const asError = (caught: unknown) =>
  caught instanceof ApiError ? caught : new ApiError(0, { title: caught instanceof Error ? caught.message : "Something went wrong." });

/**
 * Registers the step-up prompt for the signed-in account (lib/confirmation.ts): requests the server refuses with
 * `confirmation_required` open it, and are repeated once the person has confirmed with the password, an authenticator
 * code (when two-factor sign-in is on) or a passkey.
 */
export function ConfirmationPrompt({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const answer = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    setConfirmer(
      () =>
        new Promise<boolean>((resolve) => {
          answer.current = resolve;
          setOpen(true);
        }),
    );
    return () => {
      setConfirmer(null);
      answer.current?.(false);
      answer.current = null;
    };
  }, []);

  function finish(confirmed: boolean) {
    answer.current?.(confirmed);
    answer.current = null;
    setOpen(false);
  }

  return <ConfirmIdentityDialog open={open} user={user} onDone={finish} />;
}

/** Asks the person to prove they are present before a protected action; `onDone(true)` once the server agrees. */
export function ConfirmIdentityDialog({ open, user, onDone }: { open: boolean; user: User; onDone: (confirmed: boolean) => void }) {
  const [method, setMethod] = useState<Method>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Fetched when the prompt opens, so the device's passkey prompt opens straight from the tap (Safari needs that).
  const [options, setOptions] = useState<PasskeyRequestOptions | null>(null);
  const canUsePasskey = passkeysSupported();
  const passkeys = useQuery({ queryKey: passkeysKey, queryFn: api.passkeys.list, enabled: open && canUsePasskey });
  const offerPasskey = canUsePasskey && (passkeys.data?.length ?? 0) > 0;

  useEffect(() => {
    if (!open || !offerPasskey) return;
    let active = true;
    api.confirmation.passkeyOptions().then(
      (fetched) => active && setOptions(fetched),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [open, offerPasskey]);

  function reset() {
    setMethod("password");
    setPassword("");
    setCode("");
    setError(null);
    setOptions(null);
  }

  function change(next: boolean) {
    if (next) return;
    reset();
    onDone(false);
  }

  async function run(confirm: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await confirm();
      reset();
      onDone(true);
    } catch (caught) {
      if (!(caught instanceof PasskeyCancelled)) setError(asError(caught));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () =>
      method === "password"
        ? api.confirmation.confirm({ proof: await auth.proveIdentity(user.username, password) })
        : api.confirmation.confirm({ code: code.trim() }),
    );
  }

  function confirmWithPasskey() {
    if (!options) return;
    const challenge = options;
    void run(async () => {
      try {
        const { credential } = await getPasskey(challenge);
        return await api.confirmation.confirm({ challengeId: challenge.challengeId, passkey: credential });
      } finally {
        // Each challenge can be answered once: fetch a fresh one for the next try.
        setOptions(null);
        api.confirmation.passkeyOptions().then(setOptions, () => undefined);
      }
    });
  }

  const fieldError = error?.fieldError(method === "password" ? "password" : "code");

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900">
          <Dialog.Title className="text-lg font-semibold">Confirm it is you</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-stone-600 dark:text-stone-300">
            This change can take your notes away or weaken your account, so a signed-in session is not enough on its own.
            After you confirm, this device is not asked again for 10 minutes.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            {error && !fieldError && <ErrorMessage>{error.message}</ErrorMessage>}
            {method === "password" ? (
              <TextField
                key="password"
                label="Your password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={fieldError}
              />
            ) : (
              <TextField
                key="code"
                label="Authenticator or recovery code"
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                error={fieldError}
              />
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {user.twoFactorEnabled && (
                <button
                  type="button"
                  className="text-left font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400"
                  onClick={() => {
                    setMethod(method === "password" ? "code" : "password");
                    setError(null);
                  }}
                >
                  {method === "password" ? "Use an authenticator code instead" : "Use your password instead"}
                </button>
              )}
              {offerPasskey && (
                <button
                  type="button"
                  disabled={!options || busy}
                  className="text-left font-medium text-maple-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-maple-400"
                  onClick={confirmWithPasskey}
                >
                  Use a passkey
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" busy={busy} disabled={method === "password" ? !password : !code.trim()}>
                Confirm
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
