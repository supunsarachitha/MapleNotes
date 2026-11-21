import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { auth, MIN_PASSWORD_LENGTH, validateNewPassword } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { focusAtEndRef } from "../lib/focus";
import { countText, formatAbsolute, formatBytes } from "../lib/format";
import { queryKeys, useAuthStatus, useSignedOut } from "../lib/queries";
import type { AuthStatus, SignedInSession, User } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { PasswordDialog } from "./PasswordDialog";
import { RecoveryKitDialog } from "./RecoveryKitDialog";
import { useToast } from "./Toaster";
import { Button, ErrorMessage, Section, Spinner, TextField } from "./ui";

/* The account's own sections of Settings: Account, the password, recovery key and sessions, and deleting. */

/**
 * A bar split between notes and files, with the numbers beside it. With a storage limit, the bar is the limit and shows
 * how much of it is used.
 */
function StorageRow() {
  const usage = useQuery({ queryKey: queryKeys.storage, queryFn: api.storage });
  if (!usage.data) return <dd className="text-stone-400">…</dd>;
  const { notesBytes, noteCount, filesBytes, fileCount, totalBytes, quotaBytes } = usage.data;
  const scale = quotaBytes ?? totalBytes;
  const notesShare = scale > 0 ? Math.min((notesBytes / scale) * 100, 100) : 0;
  const filesShare = scale > 0 ? Math.min((filesBytes / scale) * 100, 100 - notesShare) : 0;
  const full = quotaBytes !== null && totalBytes >= quotaBytes;
  const almostFull = quotaBytes !== null && !full && totalBytes >= quotaBytes * 0.9;
  const ofLimit = quotaBytes !== null ? ` of ${formatBytes(quotaBytes)}` : "";
  return (
    <dd>
      <span className="font-medium">{formatBytes(totalBytes)}</span>
      {ofLimit && <span className="text-stone-500 dark:text-stone-400">{ofLimit}</span>}
      <div
        className="my-1.5 flex h-2 max-w-72 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
        role="img"
        aria-label={`Notes ${formatBytes(notesBytes)}, files ${formatBytes(filesBytes)}${ofLimit}`}
      >
        <div className="bg-maple-700" style={{ width: `${notesShare}%` }} />
        <div className="bg-maple-400" style={{ width: `${filesShare}%` }} />
      </div>
      <span className="text-xs text-stone-500 dark:text-stone-400">
        Notes {formatBytes(notesBytes)} ({noteCount.toLocaleString()}) · Files {formatBytes(filesBytes)} ({fileCount.toLocaleString()})
      </span>
      {full ? (
        <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">
          Your storage is full. Delete notes or files to make room, or ask an administrator for more space.
        </p>
      ) : almostFull ? (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">Your storage is almost full.</p>
      ) : null}
    </dd>
  );
}

/** The display name, with a small form to change it; empty goes back to the username. */
function DisplayNameRow({ user }: { user: User }) {
  const displayName = useAuthStatus().data?.user?.displayName ?? user.displayName;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await api.updateDisplayName(draft);
      queryClient.setQueryData<AuthStatus>(queryKeys.status, (status) => status && { ...status, user: saved });
      setEditing(false);
      setError(undefined);
      toast.info("Display name changed.");
    } catch (caught) {
      setError(caught instanceof ApiError ? (caught.fieldError("displayName") ?? caught.message) : "Could not change the name.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <dd className="flex flex-wrap items-center gap-x-3">
        <span>{displayName}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(displayName);
            setEditing(true);
          }}
          aria-label="Change display name"
          className="text-sm font-medium text-maple-700 hover:underline dark:text-maple-400"
        >
          Change
        </button>
      </dd>
    );
  }

  return (
    <dd>
      <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-center gap-2">
        <input
          ref={focusAtEndRef}
          aria-label="Display name"
          value={draft}
          maxLength={64}
          onChange={(event) => setDraft(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 text-sm dark:border-stone-700 dark:bg-stone-950"
        />
        <Button type="submit" busy={saving} className="h-9 px-3">
          Save
        </Button>
        <Button variant="secondary" className="h-9 px-3" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Leave it empty to use your username.</p>
      )}
    </dd>
  );
}

export function ProfileSection({ user }: { user: User }) {
  return (
    <Section title="Profile">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-stone-500 dark:text-stone-400">Username</dt>
        <dd>@{user.username}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Display name</dt>
        <DisplayNameRow user={user} />
        <dt className="text-stone-500 dark:text-stone-400">Role</dt>
        <dd>{user.role === "Admin" ? "Administrator" : "Member"}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Member since</dt>
        <dd>{formatAbsolute(user.createdAtUtc)}</dd>
      </dl>
    </Section>
  );
}

export function StorageSection() {
  return (
    <Section title="Storage" description="Notes and files you keep, including archived ones and the trash.">
      <dl className="text-sm">
        <dt className="sr-only">Storage used</dt>
        <StorageRow />
      </dl>
    </Section>
  );
}

export function PasswordSection({ user }: { user: User }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const change = useMutation({
    mutationFn: () => auth.changePassword(user, current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setError(null);
      toast.info("Password changed. Your other sessions were signed out.");
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught : null),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const weakPassword = validateNewPassword(next);
    if (weakPassword) {
      setError(new ApiError(400, { errors: { newPassword: [weakPassword] } }));
      return;
    }
    change.mutate();
  }

  return (
    <Section title="Password" description="Changing your password signs you out on every other device.">
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
        {error && !error.fieldError("currentPassword") && !error.fieldError("newPassword") && <ErrorMessage>{error.message}</ErrorMessage>}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={error?.fieldError("currentPassword")}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={error?.fieldError("newPassword")}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <Button type="submit" busy={change.isPending} className="self-start">
          Change password
        </Button>
      </form>
    </Section>
  );
}

/** Replaces the recovery key of an end-to-end account; the new one is shown once. */
export function RecoverySection({ user }: { user: User }) {
  const [confirming, setConfirming] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  return (
    <Section
      title="Recovery key"
      description="If you forget your password, your recovery key lets you set a new one without losing your notes. Create a new one if you lost it or someone else may have seen it."
    >
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Create a new recovery key…
      </Button>
      <PasswordDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Create a new recovery key?"
        description={<p>Your current recovery key stops working. You will see the new one once, so be ready to save it.</p>}
        confirmLabel="Create"
        onConfirm={async (password) => {
          setNewKey(await e2ee.replaceRecoveryKey(user, password));
          setConfirming(false);
        }}
      />
      <RecoveryKitDialog recoveryKey={newKey} username={user.username} onDone={() => setNewKey(null)} />
    </Section>
  );
}

/** The account's signed-in browsers and devices, each with its own Sign out, plus Sign out everywhere. */
export function SessionsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const signedOut = useSignedOut();
  const [confirm, setConfirm] = useState(false);
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: api.sessions });
  const signOut = useMutation({ mutationFn: api.signOutEverywhere, onSuccess: signedOut });
  const end = useMutation({
    mutationFn: async (session: SignedInSession) => {
      // This browser signs out the usual way, so its unsent changes and saved key are forgotten too.
      if (session.current) await api.logout();
      else await api.endSession(session.id);
    },
    onSuccess: (_, session) => {
      if (session.current) signedOut();
      else void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error, session) => {
      // Already ended elsewhere (or by its own sign-out): refresh the list rather than report a failure.
      if (error instanceof ApiError && error.status === 404) void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      else toast.error(session.current ? "Could not sign out. Please try again." : "Could not sign that device out. Please try again.");
    },
  });

  return (
    <Section
      title="Sessions"
      description="Browsers and devices signed in to your account. Sign out any you do not recognise, or every one at once if you lost a device."
    >
      {sessions.isPending ? (
        <Spinner />
      ) : sessions.isError ? (
        <ErrorMessage>Could not load the signed-in devices.</ErrorMessage>
      ) : (
        <ul className="mb-4 divide-y divide-stone-100 dark:divide-stone-800" aria-label="Signed-in devices">
          {sessions.data.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm">
                  {session.device}
                  {session.current && (
                    <span className="ml-2 whitespace-nowrap rounded-full bg-maple-50 px-2 py-0.5 text-xs font-medium text-maple-700 dark:bg-maple-600/15 dark:text-maple-400">
                      This device
                    </span>
                  )}
                  {session.newDevice && (
                    <span className="ml-2 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      New device
                    </span>
                  )}
                </p>
                {/* One fact per line: joined with dots they wrap mid-list on phones and start lines with a dot. */}
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  <span className="block">Signed in {formatAbsolute(session.createdAtUtc)}</span>
                  <span className="block">Last used {formatAbsolute(session.lastSeenAtUtc)}</span>
                  {session.ipAddress && <span className="block break-all">From {session.ipAddress}</span>}
                </p>
              </div>
              <Button
                variant="ghost"
                className="ml-auto shrink-0"
                aria-label={`Sign out ${session.device}${session.current ? " (this device)" : ""}`}
                busy={end.isPending && end.variables?.id === session.id}
                onClick={() => end.mutate(session)}
              >
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setConfirm(true)}>
        Sign out everywhere
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out everywhere?"
        description="Every session of your account ends, including this one. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        busy={signOut.isPending}
        onConfirm={() => signOut.mutate()}
      />
    </Section>
  );
}


/** Starting again: every note and file goes, the account, its password, keys and settings stay. */
export function DeleteContentSection({ username }: { username: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <Section
      title="Delete all notes and files"
      description="Start again with an empty account. Your username, password, settings and encryption stay as they are."
    >
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete all notes and files…
      </Button>
      <PasswordDialog
        open={open}
        onOpenChange={setOpen}
        danger
        title="Delete all your notes and files?"
        description={
          <>
            <p>
              Every note, todo list, quick note, daily note, habit, tag and file in your account is deleted. This cannot
              be undone.
            </p>
            <p>Export your notes first if you might want them back.</p>
          </>
        }
        confirmLabel="Delete everything"
        onConfirm={async (password) => {
          const deleted = await api.deleteAllContent(await auth.proveIdentity(username, password));
          setOpen(false);
          await queryClient.invalidateQueries();
          toast.info(`Deleted ${countText(deleted.notes, "note")} and ${countText(deleted.files, "file")}.`);
        }}
      />
    </Section>
  );
}

export function DeleteAccountSection({ username }: { username: string }) {
  const signedOut = useSignedOut();
  const [open, setOpen] = useState(false);

  return (
    <Section title="Delete account" description="Permanently delete your account, all of your notes and all attached files.">
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete my account…
      </Button>
      <PasswordDialog
        open={open}
        onOpenChange={setOpen}
        danger
        title="Delete your account?"
        description={
          <>
            <p>All of your notes and files are deleted, and your encryption key is destroyed. This cannot be undone.</p>
            <p>Consider exporting your notes first.</p>
          </>
        }
        confirmLabel="Delete forever"
        onConfirm={async (password) => {
          await api.deleteAccount(await auth.proveIdentity(username, password));
          signedOut();
        }}
      />
    </Section>
  );
}
