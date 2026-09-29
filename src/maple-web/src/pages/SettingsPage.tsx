import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EncryptionSection } from "../components/EncryptionSection";
import { ExportSection } from "../components/ExportSection";
import { WritingSection } from "../components/PreferenceSections";
import { PasswordDialog } from "../components/PasswordDialog";
import { RecoveryKitDialog } from "../components/RecoveryKitDialog";
import { useToast } from "../components/Toaster";
import { Button, cn, ErrorMessage, Section, Switch, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { auth, MIN_PASSWORD_LENGTH, validateNewPassword } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { formatAbsolute } from "../lib/format";
import { queryKeys, useSignedOut } from "../lib/queries";
import type { AdminUser, User } from "../lib/types";

function AccountSection({ user }: { user: User }) {
  return (
    <Section title="Account">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-stone-500 dark:text-stone-400">Username</dt>
        <dd>@{user.username}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Display name</dt>
        <dd>{user.displayName}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Role</dt>
        <dd>{user.role === "Admin" ? "Administrator" : "Member"}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Member since</dt>
        <dd>{formatAbsolute(user.createdAtUtc)}</dd>
      </dl>
    </Section>
  );
}

function PasswordSection({ user }: { user: User }) {
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
function RecoverySection({ user }: { user: User }) {
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

function SessionsSection() {
  const signedOut = useSignedOut();
  const [confirm, setConfirm] = useState(false);
  const signOut = useMutation({ mutationFn: api.signOutEverywhere, onSuccess: signedOut });

  return (
    <Section title="Sessions" description="Lost a device? Sign out everywhere, including here.">
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

function DeleteAccountSection({ username }: { username: string }) {
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

function AdminSection({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: queryKeys.adminSettings, queryFn: api.admin.settings });
  const users = useQuery({ queryKey: queryKeys.adminUsers, queryFn: api.admin.users });
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const deleteUser = useMutation({
    mutationFn: (id: string) => api.admin.deleteUser(id),
    onSuccess: () => {
      setToDelete(null);
      toast.info("Account deleted.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not delete the account."),
  });

  const updateSettings = useMutation({
    mutationFn: api.admin.updateSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.adminSettings, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.status });
    },
    onError: () => toast.error("Could not save the setting."),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...changes }: { id: string; isDisabled?: boolean; role?: AdminUser["role"] }) =>
      api.admin.updateUser(id, changes),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not update the account."),
  });

  return (
    <Section title="Administration" description="Administrators manage accounts but can never read anyone's notes.">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Open registration</p>
          <p className="text-sm text-stone-600 dark:text-stone-300">Let visitors create their own accounts.</p>
        </div>
        <Switch
          label="Open registration"
          checked={settings.data?.allowRegistration ?? false}
          disabled={!settings.data || updateSettings.isPending}
          onCheckedChange={(checked) => updateSettings.mutate(checked)}
        />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold">Accounts</h3>
      {users.data ? (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {users.data.map((account) => {
            const self = account.id === currentUserId;
            return (
              <li key={account.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {account.displayName} <span className="font-normal text-stone-500">@{account.username}</span>
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {account.role === "Admin" ? "Administrator" : "Member"} · {account.noteCount} notes
                    {account.isDisabled && <span className="ml-1 font-medium text-red-700 dark:text-red-400">· Disabled</span>}
                  </p>
                </div>
                {!self && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => updateUser.mutate({ id: account.id, role: account.role === "Admin" ? "User" : "Admin" })}
                    >
                      {account.role === "Admin" ? "Make member" : "Make admin"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => updateUser.mutate({ id: account.id, isDisabled: !account.isDisabled })}
                    >
                      {account.isDisabled ? "Enable" : "Disable"}
                    </Button>
                    <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setToDelete(account)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">Loading accounts…</p>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete @${toDelete?.username ?? ""}?`}
        description={`The account and its ${toDelete?.noteCount ?? 0} notes and all attached files are deleted permanently.`}
        confirmLabel="Delete account"
        busy={deleteUser.isPending}
        onConfirm={() => toDelete && deleteUser.mutate(toDelete.id)}
      />
    </Section>
  );
}

/**
 * Settings that are rarely changed or hard to undo, collapsed until opened. It opens by itself while notes are being
 * converted after an encryption change, so the progress stays in view.
 */
function AdvancedSection({ user }: { user: User }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const encryption = useQuery({ queryKey: queryKeys.encryption, queryFn: api.encryption });
  const expanded = open || encryption.data?.inProgress === true;

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          aria-label="Advanced"
          aria-describedby={`${id}-description`}
          onClick={() => setOpen(!expanded)}
          className="flex w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-5 text-left shadow-sm hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-maple-500 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Advanced</span>
            <span id={`${id}-description`} className="mt-1 block text-sm font-normal text-stone-600 dark:text-stone-300">
              Encryption{user.hasEndToEndKey ? ", recovery key" : ""}, sessions and deleting your account.
            </span>
          </span>
          <ChevronDown
            className={cn("size-5 shrink-0 text-stone-500 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </h2>
      {expanded && (
        <div id={`${id}-content`} className="flex flex-col gap-4">
          <EncryptionSection user={user} />
          {user.hasEndToEndKey && <RecoverySection user={user} />}
          <SessionsSection />
          <DeleteAccountSection username={user.username} />
        </div>
      )}
    </section>
  );
}

/**
 * Account and everyday settings first, then backup and restore, then the collapsed Advanced section, and for
 * administrators the instance settings.
 */
export function SettingsPage({ user }: { user: User }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <AccountSection user={user} />
      <WritingSection />
      <ExportSection user={user} />
      <PasswordSection user={user} />
      <AdvancedSection user={user} />
      {user.role === "Admin" && <AdminSection currentUserId={user.id} />}
    </div>
  );
}
