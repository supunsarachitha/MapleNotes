import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EncryptionSection } from "../components/EncryptionSection";
import { ExportSection } from "../components/ExportSection";
import { AppearanceSection, FeaturesSection, WritingSection } from "../components/PreferenceSections";
import { PasswordDialog } from "../components/PasswordDialog";
import { RecoveryKitDialog } from "../components/RecoveryKitDialog";
import { useToast } from "../components/Toaster";
import { Button, cn, ErrorMessage, Section, Switch, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { auth, MIN_PASSWORD_LENGTH, validateNewPassword } from "../lib/auth";
import { e2ee } from "../lib/e2ee";
import { formatAbsolute, formatBytes } from "../lib/format";
import { queryKeys, useSignedOut } from "../lib/queries";
import type { AdminUser, InstanceSettings, User } from "../lib/types";

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
        <dt className="text-stone-500 dark:text-stone-400">Storage</dt>
        <StorageRow />
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

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Starting again: every note and file goes, the account, its password, keys and settings stay. */
function DeleteContentSection({ username }: { username: string }) {
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
          toast.info(`Deleted ${count(deleted.notes, "note")} and ${count(deleted.files, "file")}.`);
        }}
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

/** What Maple Notes stores on this server and the space left: totals only, never an account's own usage. */
function InstanceStorageSummary() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const storage = useQuery({ queryKey: queryKeys.instanceStorage, queryFn: api.admin.storage });
  const compact = useMutation({
    mutationFn: () => api.admin.compactDatabase(),
    onSuccess: ({ bytesBefore, bytesAfter }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.instanceStorage });
      toast.info(
        bytesAfter < bytesBefore
          ? `Database compacted from ${formatBytes(bytesBefore)} to ${formatBytes(bytesAfter)}.`
          : "The database was already compact.",
      );
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not compact the database."),
  });
  if (!storage.data) return null;
  const { totalBytes, databaseBytes, filesBytes, backupsBytes, freeBytes } = storage.data;
  return (
    <div className="mb-5 rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
      <p className="font-medium">Server storage</p>
      <p className="mt-0.5 text-stone-600 dark:text-stone-300">
        Maple Notes uses {formatBytes(totalBytes)}
        {freeBytes !== null && <> · {formatBytes(freeBytes)} free on its volume</>}
      </p>
      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
        Database {formatBytes(databaseBytes)} · Files {formatBytes(filesBytes)} · Backups {formatBytes(backupsBytes)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="secondary" className="h-8 px-3 text-xs" busy={compact.isPending} onClick={() => compact.mutate()}>
          Compact database
        </Button>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          Gives the space left by deleted notes back to the disk.
        </span>
      </div>
    </div>
  );
}

const MAX_STORAGE_LIMIT_MB = 16 * 1024 * 1024;
const LIMIT_UNITS = { MB: 1, GB: 1024 } as const;
type LimitUnit = keyof typeof LIMIT_UNITS;

/** A limit in megabytes as the admin would type it: whole gigabytes in GB, anything else in MB. */
function limitAmount(megabytes: number): { amount: string; unit: LimitUnit } {
  return megabytes % 1024 === 0 ? { amount: String(megabytes / 1024), unit: "GB" } : { amount: String(megabytes), unit: "MB" };
}

/**
 * The storage limit per account: off by default. Turning the switch on shows the amount to save; turning it off
 * removes the limit at once.
 */
function StorageLimitSetting({
  settings,
  saving,
  onSave,
}: {
  settings: InstanceSettings;
  saving: boolean;
  onSave: (settings: InstanceSettings) => void;
}) {
  const id = useId();
  const saved = settings.storageQuotaMb;
  const initial = limitAmount(saved ?? 5 * 1024);
  const [limited, setLimited] = useState(saved !== null);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<LimitUnit>(initial.unit);
  const [error, setError] = useState<string>();

  function toggle(on: boolean) {
    setLimited(on);
    setError(undefined);
    if (!on && saved !== null) onSave({ ...settings, storageQuotaMb: null });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const megabytes = Math.round(Number(amount) * LIMIT_UNITS[unit]);
    if (!amount.trim() || !Number.isFinite(megabytes) || megabytes < 1 || megabytes > MAX_STORAGE_LIMIT_MB) {
      setError("Enter an amount from 1 MB to 16 TB.");
      return;
    }
    setError(undefined);
    onSave({ ...settings, storageQuotaMb: megabytes });
  }

  return (
    <div className="mt-5 border-t border-stone-100 pt-5 dark:border-stone-800">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Storage limit</p>
          <p id={`${id}-hint`} className="text-sm text-stone-600 dark:text-stone-300">
            The most each account can store, notes and files together. You never see how much an account uses.
          </p>
        </div>
        <Switch label="Storage limit" checked={limited} disabled={saving} describedBy={`${id}-hint`} onCheckedChange={toggle} />
      </div>
      {limited && (
        <form className="mt-3" onSubmit={save} noValidate>
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="Per account"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="w-32"
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-unit`} className="text-sm font-medium text-stone-700 dark:text-stone-200">
                Unit
              </label>
              <select
                id={`${id}-unit`}
                value={unit}
                onChange={(event) => setUnit(event.target.value as LimitUnit)}
                className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
              >
                <option value="MB">MB</option>
                <option value="GB">GB</option>
              </select>
            </div>
            <Button type="submit" busy={saving} className="mb-0.5">
              Save limit
            </Button>
          </div>
          {error && (
            <div id={`${id}-error`} className="mt-2">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          )}
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {saved !== null
              ? `Each account can store up to ${formatBytes(saved * 1024 * 1024)}. Accounts over the limit keep their notes and files but cannot add more.`
              : "Not saved yet: accounts can store as much as the server has room for."}
          </p>
        </form>
      )}
    </div>
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
    mutationFn: (next: InstanceSettings) => api.admin.updateSettings(next),
    onSuccess: (saved) => {
      const before = settings.data;
      queryClient.setQueryData(queryKeys.adminSettings, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.status });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storage });
      if (before && before.storageQuotaMb !== saved.storageQuotaMb) {
        toast.info(
          saved.storageQuotaMb === null
            ? "Storage limit removed."
            : `Each account can now store up to ${formatBytes(saved.storageQuotaMb * 1024 * 1024)}.`,
        );
      }
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save the setting."),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...changes }: { id: string; isDisabled?: boolean; role?: AdminUser["role"] }) =>
      api.admin.updateUser(id, changes),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not update the account."),
  });

  return (
    <Section title="Administration" description="Administrators manage accounts but can never read anyone's notes.">
      <InstanceStorageSummary />
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Open registration</p>
          <p className="text-sm text-stone-600 dark:text-stone-300">Let visitors create their own accounts.</p>
        </div>
        <Switch
          label="Open registration"
          checked={settings.data?.allowRegistration ?? false}
          disabled={!settings.data || updateSettings.isPending}
          onCheckedChange={(checked) => settings.data && updateSettings.mutate({ ...settings.data, allowRegistration: checked })}
        />
      </div>
      {settings.data && (
        <StorageLimitSetting
          key={String(settings.data.storageQuotaMb)}
          settings={settings.data}
          saving={updateSettings.isPending}
          onSave={(next) => updateSettings.mutate(next)}
        />
      )}

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
          <DeleteContentSection username={user.username} />
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
      <AppearanceSection />
      <WritingSection />
      <FeaturesSection />
      <ExportSection user={user} />
      <PasswordSection user={user} />
      <AdvancedSection user={user} />
      {user.role === "Admin" && <AdminSection currentUserId={user.id} />}
    </div>
  );
}
