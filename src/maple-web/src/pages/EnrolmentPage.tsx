import { ShieldCheck } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { PasskeysSection } from "../components/PasskeysSection";
import { TwoFactorSection } from "../components/TwoFactorSection";
import { Button } from "../components/ui";
import { api } from "../lib/api";
import { useBranding } from "../lib/branding";
import { useSignedOut } from "../lib/queries";
import type { User } from "../lib/types";

/**
 * Shown instead of the app when the server requires a second factor for this account and it has none. The server
 * refuses everything else from this session until it has one (the restricted session of docs/threat-model.md), so the
 * page offers only what still works: setting up two-factor sign-in or a passkey, and signing out. Once either is
 * saved, the account is fetched again and the app opens.
 */
export function EnrolmentPage({ user }: { user: User }) {
  const { appName } = useBranding();
  const signedOut = useSignedOut();
  const admin = user.role === "Admin";
  return (
    <main className="flex min-h-dvh justify-center bg-stone-100 px-4 py-10 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">Add a second sign-in step</h1>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            This {appName} server requires {admin ? "administrators" : "every account"} to sign in with two-factor
            sign-in or a passkey, so a stolen password alone cannot open your notes. Set up either one to continue.
            Until then, your notes stay as they are and nothing else can be done with this account.
          </p>
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-maple-50 px-3 py-2 text-sm text-maple-700 dark:bg-maple-600/15 dark:text-maple-100">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Signed in as <strong>@{user.username}</strong>. One of the two is enough; you can add the other later in
            Settings → Privacy & security.
          </span>
        </p>
        <TwoFactorSection user={user} />
        <PasskeysSection user={user} />
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void api.logout().finally(signedOut)}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
