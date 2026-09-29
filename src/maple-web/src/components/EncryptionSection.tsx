import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { queryKeys } from "../lib/queries";
import type { EncryptionMode, EncryptionStatus, User } from "../lib/types";
import { EndToEndSetupDialog } from "./EndToEndSetupDialog";
import { PasswordDialog } from "./PasswordDialog";
import { Card, cn, Spinner } from "./ui";

const MODES: Array<{ mode: EncryptionMode; title: string; description: string }> = [
  {
    mode: "Off",
    title: "Off",
    description: "Stored without per-account encryption. The database itself is always encrypted.",
  },
  {
    mode: "AtRest",
    title: "Encrypted at rest",
    description:
      "Encrypted with a key of your account that this server holds. Protects stolen disks and backups, not a compromised server.",
  },
  {
    mode: "EndToEnd",
    title: "End-to-end",
    description:
      "Encrypted in your browser with a key only you hold: the server cannot read your notes. Without your password or recovery key they cannot be recovered.",
  },
];

/** What confirming a change from `from` to `to` says. */
function transition(from: EncryptionMode, to: EncryptionMode, user: User): { title: string; confirm: string; body: ReactNode } {
  if (from === "EndToEnd") {
    return {
      title: "Turn off end-to-end encryption?",
      confirm: "Turn off",
      body: (
        <>
          <p>
            This browser decrypts your notes and files and gives them back to the server, which then
            {to === "AtRest" ? " encrypts them with a key it holds" : " stores them without per-account encryption"}. The
            server will be able to read them again.
          </p>
          <p>Keep Maple Notes open until this finishes. If you close it, it continues the next time you open it.</p>
        </>
      ),
    };
  }
  if (to === "EndToEnd" && user.hasEndToEndKey) {
    return {
      title: "Switch back to end-to-end encryption?",
      confirm: "Switch back",
      body: <p>Your existing end-to-end key is used again, and this browser encrypts the notes that are not encrypted yet.</p>,
    };
  }
  return to === "AtRest"
    ? {
        title: "Turn on encryption at rest?",
        confirm: "Turn on",
        body: <p>Your existing notes and files will be encrypted in the background. New notes are encrypted right away.</p>,
      }
    : {
        title: "Turn off encryption at rest?",
        confirm: "Turn off",
        body: (
          <>
            <p>Your notes and files will be stored without the extra per-account encryption layer.</p>
            <p>The database itself stays encrypted either way.</p>
          </>
        ),
      };
}

/**
 * The account's encryption mode: off, at rest or end-to-end. Every change requires the password. Existing content is
 * converted in the background between off and at rest, and by this browser to and from end-to-end encryption; progress
 * is polled while that runs.
 */
export function EncryptionSection({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: queryKeys.encryption,
    queryFn: api.encryption,
    refetchInterval: (query) => (query.state.data?.inProgress ? 1000 : false),
  });
  const [target, setTarget] = useState<EncryptionMode | null>(null);

  const data = status.data;
  const current = data?.mode;
  const settingUp = target === "EndToEnd" && !user.hasEndToEndKey;
  const change = current && target && !settingUp ? transition(current, target, user) : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.encryption });
    await queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }

  async function confirm(password: string) {
    if (!target) return;
    const updated = await api.setEncryption(target, await auth.proveIdentity(user.username, password));
    queryClient.setQueryData<EncryptionStatus>(queryKeys.encryption, updated); // the answer is the new status
    setTarget(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }

  const done = data ? data.totalItems - data.remainingItems : 0;
  const percent = data && data.totalItems > 0 ? Math.round((done / data.totalItems) * 100) : 100;
  const inBrowser = current === "EndToEnd" || user.hasEndToEndKey;
  const Icon = current === "EndToEnd" ? ShieldCheck : current === "Off" ? LockOpen : Lock;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Encryption</h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            How your notes and files are protected on this server.
          </p>
        </div>
        {!data && <Spinner className="mt-1 size-5 text-stone-400" />}
      </div>

      {data && (
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="sr-only">Encryption mode</legend>
          {MODES.map((option) => (
            <label
              key={option.mode}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                current === option.mode
                  ? "border-maple-600 bg-maple-50/60 dark:border-maple-500 dark:bg-maple-600/10"
                  : "border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/50",
              )}
            >
              <input
                type="radio"
                name="encryption-mode"
                value={option.mode}
                checked={current === option.mode}
                onChange={() => setTarget(option.mode)}
                className="mt-1 size-4 shrink-0 accent-maple-600"
              />
              <span>
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-sm text-stone-600 dark:text-stone-300">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {data?.inProgress && (
        <div className="mt-5" aria-live="polite">
          <div className="mb-1.5 flex justify-between gap-3 text-sm">
            <span>
              {current === "EndToEnd"
                ? "Encrypting your existing notes and files in this browser…"
                : inBrowser
                  ? "Decrypting your notes and files in this browser…"
                  : current === "AtRest"
                    ? "Encrypting your existing notes and files…"
                    : "Removing the extra encryption layer…"}
            </span>
            <span className="shrink-0 tabular-nums text-stone-500">
              {done.toLocaleString()} of {data.totalItems.toLocaleString()}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Conversion progress"
            className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
          >
            <div className="h-full rounded-full bg-maple-600 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {inBrowser
              ? "Keep Maple Notes open until this finishes. If you close it, it continues the next time you open it."
              : "You can keep using Maple Notes; everything stays readable while this runs."}
          </p>
        </div>
      )}

      <PasswordDialog
        open={change !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={change?.title ?? ""}
        description={change?.body}
        confirmLabel={change?.confirm ?? ""}
        onConfirm={confirm}
      />
      <EndToEndSetupDialog
        user={user}
        open={settingUp}
        onClose={(enabled) => {
          setTarget(null);
          if (enabled) void refresh();
        }}
      />
    </Card>
  );
}
