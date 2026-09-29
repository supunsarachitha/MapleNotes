import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toaster";
import { Button, Card, ErrorMessage, Switch, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatAbsolute } from "../lib/format";
import { queryKeys, useSignedOut } from "../lib/queries";
import type { AdminUser, User } from "../lib/types";

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
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
      </dl>
    </Section>
  );
}

function PasswordSection() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
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
          minLength={10}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={error?.fieldError("newPassword")}
          hint="At least 10 characters."
        />
        <Button type="submit" busy={change.isPending} className="self-start">
          Change password
        </Button>
      </form>
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

function AdminSection({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: queryKeys.adminSettings, queryFn: api.admin.settings });
  const users = useQuery({ queryKey: queryKeys.adminUsers, queryFn: api.admin.users });

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
                      variant={account.isDisabled ? "secondary" : "danger"}
                      className="h-8 px-3 text-xs"
                      onClick={() => updateUser.mutate({ id: account.id, isDisabled: !account.isDisabled })}
                    >
                      {account.isDisabled ? "Enable" : "Disable"}
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
    </Section>
  );
}

/** Account, security and (for administrators) instance settings. */
export function SettingsPage({ user, extraSections }: { user: User; extraSections?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <AccountSection user={user} />
      {extraSections}
      <PasswordSection />
      <SessionsSection />
      {user.role === "Admin" && <AdminSection currentUserId={user.id} />}
    </div>
  );
}
