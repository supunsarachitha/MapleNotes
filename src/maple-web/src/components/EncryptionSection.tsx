import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { queryKeys } from "../lib/queries";
import type { EncryptionStatus, User } from "../lib/types";
import { PasswordDialog } from "./PasswordDialog";
import { Card, Spinner, Switch } from "./ui";

export const encryptionKey = ["account", "encryption"] as const;

type AtRestMode = "Off" | "AtRest";

/**
 * The account's encryption mode. Switching encryption at rest requires the password; existing notes and files are
 * then converted in the background, and progress is polled while that runs.
 */
export function EncryptionSection({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: encryptionKey,
    queryFn: api.encryption,
    refetchInterval: (query) => (query.state.data?.inProgress ? 1000 : false),
  });
  const [target, setTarget] = useState<AtRestMode | null>(null);

  async function confirm(password: string) {
    if (target === null) return;
    const updated = await api.setEncryption(target, await auth.proveIdentity(user.username, password));
    queryClient.setQueryData<EncryptionStatus>(encryptionKey, updated);
    setTarget(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }

  const data = status.data;
  const endToEnd = data?.mode === "EndToEnd";
  const done = data ? data.totalItems - data.remainingItems : 0;
  const percent = data && data.totalItems > 0 ? Math.round((done / data.totalItems) * 100) : 100;
  const Icon = endToEnd ? ShieldCheck : data?.mode === "Off" ? LockOpen : Lock;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {endToEnd ? (
            <>
              <h2 className="text-base font-semibold">End-to-end encryption is on</h2>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                Your notes and files are encrypted in your browser before they are sent, with a key only you hold. The
                server stores them but cannot read them.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">Encryption at rest</h2>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                Encrypt your notes and attachments with a key that belongs only to your account, on top of the encrypted
                database. Keys are held by this server, so this protects stolen disks and backups, not a compromised
                server.
              </p>
            </>
          )}
        </div>
        {!data ? (
          // Never show an "off" switch while the real state is still loading.
          <Spinner className="mt-1 size-5 text-stone-400" />
        ) : (
          !endToEnd && (
            <Switch
              label="Encrypt my notes and attachments"
              checked={data.mode === "AtRest"}
              onCheckedChange={(checked) => setTarget(checked ? "AtRest" : "Off")}
            />
          )
        )}
      </div>

      {data?.inProgress && (
        <div className="mt-5" aria-live="polite">
          <div className="mb-1.5 flex justify-between text-sm">
            <span>
              {data.mode === "AtRest"
                ? "Encrypting your existing notes and files…"
                : data.mode === "Off"
                  ? "Removing the extra encryption layer…"
                  : "Encrypting your existing notes and files in this browser…"}
            </span>
            <span className="tabular-nums text-stone-500">
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
            You can keep using Maple Notes; everything stays readable while this runs.
          </p>
        </div>
      )}

      <PasswordDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target === "AtRest" ? "Turn on encryption at rest?" : "Turn off encryption at rest?"}
        description={
          target === "AtRest" ? (
            <p>Your existing notes and files will be encrypted in the background. New notes are encrypted right away.</p>
          ) : (
            <>
              <p>Your notes and files will be stored without the extra per-account encryption layer.</p>
              <p>The database itself stays encrypted either way.</p>
            </>
          )
        }
        confirmLabel={target === "AtRest" ? "Turn on" : "Turn off"}
        onConfirm={confirm}
      />
    </Card>
  );
}
