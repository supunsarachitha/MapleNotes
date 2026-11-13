import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAbsolute } from "../lib/format";
import { queryKeys, useSignedOut } from "../lib/queries";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toaster";
import { Button } from "./ui";

/**
 * Banners about sign-ins from a browser and network the account had not used recently (the server decides what is
 * new, Features/Auth/SignInDevices.cs). Each stays on every device until it is dismissed with "It was me", or until
 * the owner signs out everywhere. The browser that signed in is not shown its own notice.
 */
export function SignInNotices() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const signedOut = useSignedOut();
  const [confirm, setConfirm] = useState(false);
  const notices = useQuery({ queryKey: queryKeys.signInNotices, queryFn: api.signInNotices, retry: false });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissSignInNotice(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.signInNotices }),
    onError: () => toast.error("Could not dismiss the notice. Please try again."),
  });
  const signOut = useMutation({ mutationFn: () => api.signOutEverywhere(), onSuccess: signedOut });

  if (!notices.data?.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {notices.data.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p className="flex min-w-0 flex-1 basis-56 items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              New sign-in on <strong className="font-semibold">{notice.device}</strong>,{" "}
              <span className="whitespace-nowrap">{formatAbsolute(notice.atUtc)}</span>. Not you? Sign out everywhere.
            </span>
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button
              variant="ghost"
              busy={dismiss.isPending && dismiss.variables === notice.id}
              onClick={() => dismiss.mutate(notice.id)}
            >
              It was me
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Sign out everywhere
            </Button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out everywhere?"
        description="Every session of your account ends, including this one. Sign in again, then change your password if someone else may know it."
        confirmLabel="Sign out everywhere"
        busy={signOut.isPending}
        onConfirm={() => signOut.mutate()}
      />
    </div>
  );
}
