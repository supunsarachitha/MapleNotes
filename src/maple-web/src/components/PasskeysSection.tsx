import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { PasskeyCancelled, passkeysSupported, PasskeyUnavailable } from "../lib/passkeys";
import type { Passkey, PasskeyCreationOptions, User } from "../lib/types";
import { useToast } from "./Toaster";
import { DialogShell } from "./TwoFactorSection";
import { Button, ErrorMessage, Section, TextField } from "./ui";

export const passkeysKey = ["account", "passkeys"] as const;

const asError = (caught: unknown) =>
  caught instanceof ApiError
    ? caught
    : new ApiError(0, { title: caught instanceof PasskeyUnavailable ? caught.message : "Something went wrong." });

/** Creates a passkey on this device: a name, the password, then the device's own prompt. */
function AddDialog({ user, open, onOpenChange }: { user: User; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Fetched when the dialog opens, so the device's prompt opens straight from the tap (Safari needs that).
  const [options, setOptions] = useState<PasskeyCreationOptions | null>(null);
  // Added, but the device gives the PRF output only when the passkey is used: offer one more tap to unlock notes.
  const [needsTap, setNeedsTap] = useState<Passkey | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api.passkeys.creationOptions().then(
      (fetched) => active && setOptions(fetched),
      (caught: unknown) => active && setError(asError(caught)),
    );
    return () => {
      active = false;
    };
  }, [open]);

  function change(next: boolean) {
    if (!next) {
      setName("");
      setPassword("");
      setError(null);
      setOptions(null);
      setNeedsTap(null);
    }
    onOpenChange(next);
  }

  async function enableUnlock() {
    if (!needsTap) return;
    setBusy(true);
    setError(null);
    try {
      await auth.enablePasskeyUnlock(user, password, needsTap);
      toast.info("This passkey now unlocks your notes too.");
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
      change(false);
    } catch (caught) {
      if (!(caught instanceof PasskeyCancelled)) setError(asError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options) return;
    setBusy(true);
    setError(null);
    try {
      const { passkey, canUnlockWithTap } = await auth.addPasskey(user, password, options, name.trim() || undefined);
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
      if (canUnlockWithTap) {
        setNeedsTap(passkey);
        return;
      }
      toast.info(
        passkey.unlocksNotes ? "Passkey added. It signs you in and unlocks your notes." : "Passkey added. You can sign in with it now.",
      );
      change(false);
    } catch (caught) {
      if (!(caught instanceof PasskeyCancelled)) setError(asError(caught));
      // Each request can be answered once: fetch a fresh one for the next try.
      setOptions(null);
      api.passkeys.creationOptions().then(setOptions, () => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (needsTap) {
    return (
      <DialogShell open={open} onOpenChange={change} title="Unlock your notes with it too?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            The passkey is added and signs you in. To also unlock your end-to-end notes with it, use it once more now.
          </p>
          {error && <ErrorMessage>{error.message}</ErrorMessage>}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Not now</Button>
            </Dialog.Close>
            <Button busy={busy} onClick={() => void enableUnlock()}>
              Use passkey
            </Button>
          </div>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell open={open} onOpenChange={change} title="Add a passkey">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Your device or password manager keeps the passkey and asks for your fingerprint, face or PIN when you sign in.
          Passkeys work only at this address.
        </p>
        {error && !error.fieldError("password") && !error.fieldError("name") && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Name (optional)"
          hint="So you can tell your passkeys apart, for example “Phone” or “Laptop”."
          maxLength={64}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error?.fieldError("name")}
        />
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldError("password")}
        />
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" busy={busy || (open && !options && !error)} disabled={!password || !options}>
            Continue
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function RenameDialog({ passkey, onOpenChange }: { passkey: Passkey | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setName(passkey?.name ?? "");
    setError(null);
  }, [passkey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passkey) return;
    setBusy(true);
    setError(null);
    try {
      await api.passkeys.rename(passkey.id, name.trim());
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
      onOpenChange(false);
    } catch (caught) {
      setError(asError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell open={passkey !== null} onOpenChange={onOpenChange} title="Rename passkey">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {error && !error.fieldError("name") && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Name"
          autoFocus
          required
          maxLength={64}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error?.fieldError("name")}
        />
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" busy={busy} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Lets an existing passkey unlock the notes: the password, then one use of the passkey. */
function UnlockDialog({ user, passkey, onOpenChange }: { user: User; passkey: Passkey | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function change(next: boolean) {
    if (!next) {
      setPassword("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passkey) return;
    setBusy(true);
    setError(null);
    try {
      await auth.enablePasskeyUnlock(user, password, passkey);
      toast.info("This passkey now unlocks your notes too.");
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
      change(false);
    } catch (caught) {
      if (!(caught instanceof PasskeyCancelled)) setError(asError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell open={passkey !== null} onOpenChange={change} title="Unlock notes with this passkey?">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Signing in with “{passkey?.name}” will then also unlock your end-to-end notes, without the password. Anyone who
          can use this passkey can read your notes, so use it only on devices you trust. Not every device supports this.
        </p>
        {error && !error.fieldError("password") && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldError("password")}
        />
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" busy={busy} disabled={!password}>
            Continue
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function RemoveDialog({ user, passkey, onOpenChange }: { user: User; passkey: Passkey | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function change(next: boolean) {
    if (!next) {
      setPassword("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passkey) return;
    setBusy(true);
    setError(null);
    try {
      await api.passkeys.remove(passkey.id, await auth.proveIdentity(user.username, password));
      toast.info("Passkey removed.");
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
      change(false);
    } catch (caught) {
      setError(asError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell open={passkey !== null} onOpenChange={change} title="Remove this passkey?">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          “{passkey?.name}” will no longer sign you in. Also delete it from your device or password manager, which this
          app cannot do for you.
        </p>
        {error && !error.fieldError("password") && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldError("password")}
        />
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" variant="danger" busy={busy} disabled={!password}>
            Remove
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Settings → Privacy & security: passkeys that sign in without the password. */
export function PasskeysSection({ user }: { user: User }) {
  const list = useQuery({ queryKey: passkeysKey, queryFn: api.passkeys.list });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [unlocking, setUnlocking] = useState<Passkey | null>(null);
  const supported = passkeysSupported();
  const date = (iso: string) => formatDate(new Date(iso), user.preferences.dateFormat);

  return (
    <Section
      title="Passkeys"
      description={
        user.hasEndToEndKey
          ? "Sign in with your fingerprint, face or device PIN instead of your password. A passkey cannot be guessed or phished, so it is not asked for a two-factor code. Where the device supports it, a passkey can also unlock your end-to-end notes."
          : "Sign in with your fingerprint, face or device PIN instead of your password. A passkey cannot be guessed or phished, so it is not asked for a two-factor code."
      }
    >
      <div className="flex flex-col gap-3">
        {list.isError && <ErrorMessage>Your passkeys could not be loaded.</ErrorMessage>}
        {list.data && list.data.length > 0 && (
          <ul aria-label="Passkeys" className="flex flex-col divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {list.data.map((passkey) => (
              <li key={passkey.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <KeyRound className="size-4 shrink-0 text-maple-600" aria-hidden="true" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium">{passkey.name}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {/* Each part stays whole, so a narrow screen never breaks a date in two. */}
                    <span className="whitespace-nowrap">{passkey.backedUp ? "Synced" : "This device only"}</span> ·{" "}
                    <span className="whitespace-nowrap">Added {date(passkey.createdAtUtc)}</span> ·{" "}
                    <span className="whitespace-nowrap">
                      {passkey.lastUsedAtUtc ? `Last used ${date(passkey.lastUsedAtUtc)}` : "Not used yet"}
                    </span>
                    {user.hasEndToEndKey && passkey.unlocksNotes && (
                      <>
                        {" "}· <span className="whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400">Unlocks notes</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex min-w-0 max-w-full flex-wrap justify-end gap-1">
                  {user.hasEndToEndKey && !passkey.unlocksNotes && supported && (
                    <Button variant="ghost" onClick={() => setUnlocking(passkey)} aria-label={`Unlock notes with ${passkey.name}`}>
                      Unlock notes…
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setRenaming(passkey)} aria-label={`Rename ${passkey.name}`}>
                    Rename
                  </Button>
                  <Button variant="ghost" onClick={() => setRemoving(passkey)} aria-label={`Remove ${passkey.name}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {supported ? (
          <div>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add a passkey…
            </Button>
          </div>
        ) : (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            This browser cannot add passkeys here. Passkeys need a recent browser and the site's HTTPS address.
          </p>
        )}
      </div>
      <AddDialog user={user} open={adding} onOpenChange={setAdding} />
      <RenameDialog passkey={renaming} onOpenChange={(open) => !open && setRenaming(null)} />
      <UnlockDialog user={user} passkey={unlocking} onOpenChange={(open) => !open && setUnlocking(null)} />
      <RemoveDialog user={user} passkey={removing} onOpenChange={(open) => !open && setRemoving(null)} />
    </Section>
  );
}
