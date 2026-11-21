import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { DEFAULT_APP_NAME, useBranding } from "../lib/branding";
import { formatBytes } from "../lib/format";
import { squareIcon } from "../lib/icon";
import { queryKeys } from "../lib/queries";
import { Link } from "../lib/router";
import { dismissSecondFactorSuggestion, ruleCovers, secondFactorSuggested } from "../lib/secondFactor";
import type { AdminUser, InstanceSettings, SecondFactorRule } from "../lib/types";
import { BrandMark } from "./BrandMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toaster";
import { Button, ErrorMessage, Section, Switch, TextField } from "./ui";

/* Settings → Administration, shown to administrators only. */

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

/** The app's name and icon, which everyone sees, on the sign-in page too. */
function BrandingSetting({ settings, saving, onSave }: { settings: InstanceSettings; saving: boolean; onSave: (settings: InstanceSettings) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { iconUrl } = useBranding();
  const [name, setName] = useState(settings.appName ?? "");
  const [changingIcon, setChangingIcon] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function changeIcon(action: () => Promise<void>, done: string) {
    setChangingIcon(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: queryKeys.status });
      toast.info(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the icon.");
    } finally {
      setChangingIcon(false);
    }
  }

  return (
    <div className="mt-5 border-t border-stone-100 pt-5 dark:border-stone-800">
      <p className="text-sm font-medium">Name and icon</p>
      <p className="text-sm text-stone-600 dark:text-stone-300">What everyone sees in the menu, the browser tab and the sign-in page.</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...settings, appName: name.trim() || null });
        }}
      >
        <TextField
          label="App name"
          placeholder={DEFAULT_APP_NAME}
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" busy={saving} className="mb-0.5">
          Save name
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <BrandMark className="size-12" />
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Icon image"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void changeIcon(async () => api.admin.setIcon(await squareIcon(file)), "Icon changed.");
          }}
        />
        <Button variant="secondary" busy={changingIcon} onClick={() => fileInput.current?.click()}>
          Choose icon…
        </Button>
        {iconUrl && (
          <Button variant="secondary" disabled={changingIcon} onClick={() => void changeIcon(api.admin.removeIcon, "The maple leaf is back.")}>
            Use the maple leaf
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
        A square PNG, JPEG or WebP image works best. It is fitted into 256 × 256 pixels.
      </p>
    </div>
  );
}

/** The session lengths offered; browsers keep a cookie for at most 400 days, the server's maximum. */
const SESSION_LENGTHS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 400, label: "400 days (the longest browsers allow)" },
];

/**
 * How long "keep me signed in" lasts after the app was last used. A device away from the server longer than that must
 * sign in again, and its notes saved for offline reading are deleted then (changes made offline are kept).
 */
function SessionLengthSetting({
  settings,
  saving,
  onSave,
}: {
  settings: InstanceSettings;
  saving: boolean;
  onSave: (settings: InstanceSettings) => void;
}) {
  const id = useId();
  const options = SESSION_LENGTHS.some((length) => length.days === settings.sessionDays)
    ? SESSION_LENGTHS
    : [...SESSION_LENGTHS, { days: settings.sessionDays, label: `${settings.sessionDays} days` }].sort((a, b) => a.days - b.days);
  return (
    <div className="mt-5 border-t border-stone-100 pt-5 dark:border-stone-800">
      <label htmlFor={id} className="text-sm font-medium">
        Stay signed in for
      </label>
      <p id={`${id}-hint`} className="text-sm text-stone-600 dark:text-stone-300">
        How long "Keep me signed in" lasts after a device last used the app. A device that stays away longer, offline for
        example, signs in again. Applies from each device's next sign-in.
      </p>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        value={settings.sessionDays}
        disabled={saving}
        onChange={(event) => onSave({ ...settings, sessionDays: Number(event.target.value) })}
        className="mt-2 h-11 max-w-full rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
      >
        {options.map((length) => (
          <option key={length.days} value={length.days}>
            {length.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const SECOND_FACTOR_CHOICES: { rule: SecondFactorRule; label: string }[] = [
  { rule: "Off", label: "Nobody (optional for everyone)" },
  { rule: "Administrators", label: "Administrators" },
  { rule: "Everyone", label: "Everyone" },
];

/**
 * Who must sign in with two-factor sign-in or a passkey. Covered accounts without either can still sign in, but can
 * only set one up or sign out until they have. The server refuses a rule that covers the administrator saving it
 * while they have neither, so the setting says so before they try.
 */
function SecondFactorRuleSetting({
  settings,
  saving,
  ownFactor,
  onSave,
}: {
  settings: InstanceSettings;
  saving: boolean;
  /** Whether the administrator has two-factor sign-in or a passkey; undefined while the account list loads. */
  ownFactor: boolean | undefined;
  onSave: (settings: InstanceSettings) => void;
}) {
  const id = useId();
  const [suggested, setSuggested] = useState(() => secondFactorSuggested() && (settings.requireSecondFactor ?? "Off") === "Off");
  const rule = settings.requireSecondFactor ?? "Off";
  const choose = (next: SecondFactorRule) => {
    dismissSecondFactorSuggestion();
    setSuggested(false);
    onSave({ ...settings, requireSecondFactor: next });
  };
  return (
    <div className="mt-5 border-t border-stone-100 pt-5 dark:border-stone-800">
      {suggested && (
        <div role="note" className="mb-4 rounded-xl bg-maple-50 px-3 py-3 text-sm text-maple-700 dark:bg-maple-600/15 dark:text-maple-100">
          <p className="font-medium">Suggested for a new server: require a second factor for administrators.</p>
          <p className="mt-1">
            An administrator's password alone then cannot open the administration.{" "}
            {ownFactor === false && (
              <>
                First set up two-factor sign-in or a passkey for your own account in{" "}
                <Link href="/settings/security" className="font-medium underline underline-offset-2">
                  Privacy & security
                </Link>
                .
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button className="h-8 px-3 text-xs" disabled={saving || ownFactor !== true} onClick={() => choose("Administrators")}>
              Require for administrators
            </Button>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => {
                dismissSecondFactorSuggestion();
                setSuggested(false);
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      )}
      <label htmlFor={id} className="text-sm font-medium">
        Require two-factor sign-in or a passkey for
      </label>
      <p id={`${id}-hint`} className="text-sm text-stone-600 dark:text-stone-300">
        An account this covers that has neither can still sign in, but can only set one up or sign out until it has. It
        applies at once, also to devices already signed in.
        {ownFactor === false && " You need one on your own account before you can require it for administrators."}
      </p>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        value={rule}
        disabled={saving}
        onChange={(event) => choose(event.target.value as SecondFactorRule)}
        className="mt-2 h-11 max-w-full rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
      >
        {SECOND_FACTOR_CHOICES.map((choice) => (
          <option key={choice.rule} value={choice.rule} disabled={choice.rule !== "Off" && choice.rule !== rule && ownFactor === false}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AdminSection({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: queryKeys.adminSettings, queryFn: api.admin.settings });
  const users = useQuery({ queryKey: queryKeys.adminUsers, queryFn: api.admin.users });
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const [twoFactorOff, setTwoFactorOff] = useState<AdminUser | null>(null);
  const ownAccount = users.data?.find((account) => account.id === currentUserId);
  const rule = settings.data?.requireSecondFactor;
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
      if (before && before.appName !== saved.appName) {
        toast.info(saved.appName ? `The app is now called ${saved.appName}.` : `The app is called ${DEFAULT_APP_NAME} again.`);
      }
      if (before && before.sessionDays !== saved.sessionDays) {
        toast.info(`Devices that sign in from now on stay signed in for ${saved.sessionDays} days after they were last used.`);
      }
      if (before && (before.requireSecondFactor ?? "Off") !== (saved.requireSecondFactor ?? "Off")) {
        toast.info(
          saved.requireSecondFactor === "Everyone"
            ? "Every account now needs two-factor sign-in or a passkey."
            : saved.requireSecondFactor === "Administrators"
              ? "Administrators now need two-factor sign-in or a passkey."
              : "Two-factor sign-in and passkeys are optional again.",
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      }
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
    mutationFn: ({ id, ...changes }: { id: string; isDisabled?: boolean; role?: AdminUser["role"]; turnOffTwoFactor?: boolean }) =>
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
      {settings.data && (
        <SessionLengthSetting settings={settings.data} saving={updateSettings.isPending} onSave={(next) => updateSettings.mutate(next)} />
      )}
      {settings.data && (
        <SecondFactorRuleSetting
          settings={settings.data}
          saving={updateSettings.isPending}
          ownFactor={ownAccount && (ownAccount.twoFactorEnabled === true || ownAccount.hasPasskey === true)}
          onSave={(next) => updateSettings.mutate(next)}
        />
      )}
      {settings.data && (
        <BrandingSetting
          key={settings.data.appName ?? ""}
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
            // Two-factor sign-in is this account's only second factor and the rule needs one: the server refuses to turn
            // it off, so the button is replaced by the reason.
            const lastFactor = account.twoFactorEnabled === true && account.hasPasskey !== true && ruleCovers(rule, account.role);
            return (
              <li key={account.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {account.displayName} <span className="font-normal text-stone-500">@{account.username}</span>
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {account.role === "Admin" ? "Administrator" : "Member"} · <span className="whitespace-nowrap">{account.noteCount} notes</span>
                    {account.twoFactorEnabled && <span className="ml-1 whitespace-nowrap">· Two-factor</span>}
                    {account.hasPasskey && <span className="ml-1 whitespace-nowrap">· Passkey</span>}
                    {ruleCovers(rule, account.role) && !account.twoFactorEnabled && !account.hasPasskey && (
                      <span className="ml-1 whitespace-nowrap text-amber-700 dark:text-amber-400">· Must set up a second factor</span>
                    )}
                    {account.isDisabled && <span className="ml-1 font-medium text-red-700 dark:text-red-400">· Disabled</span>}
                  </p>
                  {!self && lastFactor && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Two-factor sign-in cannot be turned off here: this server requires a second factor for this account
                      and it has no passkey. Change who must use one above first.
                    </p>
                  )}
                </div>
                {!self && (
                  <div className="flex flex-wrap gap-2 [&>button]:whitespace-nowrap">
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
                    {account.twoFactorEnabled && !lastFactor && (
                      <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setTwoFactorOff(account)}>
                        Turn off two-factor
                      </Button>
                    )}
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
        open={twoFactorOff !== null}
        onOpenChange={(open) => !open && setTwoFactorOff(null)}
        title={`Turn off two-factor sign-in for @${twoFactorOff?.username ?? ""}?`}
        description="For someone who lost both their authenticator app and their recovery codes. Their password is still needed to sign in; make sure the request really comes from them."
        confirmLabel="Turn off"
        busy={updateUser.isPending}
        onConfirm={() =>
          twoFactorOff &&
          updateUser.mutate(
            { id: twoFactorOff.id, turnOffTwoFactor: true },
            {
              onSuccess: () => {
                toast.info(`Two-factor sign-in is off for @${twoFactorOff.username}.`);
                setTwoFactorOff(null);
              },
            },
          )
        }
      />
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
