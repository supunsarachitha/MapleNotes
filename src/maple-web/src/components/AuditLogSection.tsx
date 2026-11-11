import { useInfiniteQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../lib/api";
import { formatAbsolute } from "../lib/format";
import { queryKeys } from "../lib/queries";
import type { AuditEntry, AuditFilter } from "../lib/types";
import { Button, cn, ErrorMessage, Section, Spinner } from "./ui";

const FILTERS: Record<AuditFilter, string> = {
  All: "Everything",
  SignIns: "Sign-ins",
  FailedSignIns: "Failed sign-ins",
  Admin: "Administrators' actions",
  Security: "Security changes",
};

const EVENT_TITLES: Record<AuditEntry["event"], string> = {
  SignIn: "Signed in",
  SignInFailed: "Sign-in refused",
  SettingsChanged: "Changed the server's settings",
  AccountChanged: "Changed an account",
  AccountDeleted: "Deleted an account",
  PasswordChanged: "Changed the password",
  TwoFactorEnabled: "Turned on two-factor sign-in",
  TwoFactorDisabled: "Turned off two-factor sign-in",
  RecoveryCodesReplaced: "Replaced the recovery codes",
  PasskeyAdded: "Added a passkey",
  PasskeyRemoved: "Removed a passkey",
  RecoveryKeyReplaced: "Replaced the recovery key",
  EncryptionChanged: "Changed the encryption",
  SignedOutEverywhere: "Signed out everywhere",
};

/** Who, and to whom: "maple", "admin → member", or "an unknown passkey". */
function who(entry: AuditEntry): string {
  const actor = entry.username || "an unknown passkey";
  return entry.targetUsername ? `${actor} → ${entry.targetUsername}` : actor;
}

/**
 * The audit log, for administrators, newest first: sign-ins (made and refused), people's changes to their own sign-in
 * and encryption, and administrators' actions.
 */
export function AuditLogSection() {
  const id = useId();
  const [filter, setFilter] = useState<AuditFilter>("All");
  const log = useInfiniteQuery({
    queryKey: queryKeys.adminAudit(filter),
    queryFn: ({ pageParam }) => api.admin.audit(filter, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Section
      title="Audit log"
      description="Sign-ins, refused sign-ins and what administrators change, kept for 180 days. Only administrators can see it."
    >
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        Show
      </label>
      <select
        id={id}
        value={filter}
        onChange={(event) => setFilter(event.target.value as AuditFilter)}
        className="h-11 w-full max-w-xs rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
      >
        {(Object.keys(FILTERS) as AuditFilter[]).map((key) => (
          <option key={key} value={key}>
            {FILTERS[key]}
          </option>
        ))}
      </select>

      {log.isPending ? (
        <div className="mt-4 flex justify-center">
          <Spinner />
        </div>
      ) : log.isError ? (
        <div className="mt-4">
          <ErrorMessage>The audit log could not be loaded.</ErrorMessage>
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-300">Nothing yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-stone-100 dark:divide-stone-800" aria-label="Audit log entries">
          {entries.map((entry) => (
            <li key={entry.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    entry.event === "SignInFailed" && "text-red-700 dark:text-red-400",
                  )}
                >
                  {EVENT_TITLES[entry.event]}
                  {entry.method && <span className="font-normal text-stone-500 dark:text-stone-400"> · {entry.method.toLowerCase()}</span>}
                </span>
                <span className="break-all text-sm text-stone-700 dark:text-stone-200">{who(entry)}</span>
              </div>
              <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">{entry.detail}</p>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                <time dateTime={entry.atUtc}>{formatAbsolute(entry.atUtc)}</time>
                {entry.ipAddress && <> · {entry.ipAddress}</>}
              </p>
            </li>
          ))}
        </ul>
      )}

      {log.hasNextPage && (
        <div className="mt-2">
          <Button variant="secondary" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {log.isFetchingNextPage ? "Loading…" : "Show older"}
          </Button>
        </div>
      )}
    </Section>
  );
}
