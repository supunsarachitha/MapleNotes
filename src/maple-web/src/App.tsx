import { useEffect, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { Logo } from "./components/Logo";
import { Button, Spinner } from "./components/ui";
import { e2ee, useEndToEndKeys } from "./lib/e2ee";
import { useAuthStatus } from "./lib/queries";
import { useLocation } from "./lib/router";
import { AuthPage } from "./pages/AuthPage";
import { ArchivePage, HomePage } from "./pages/HomePage";
import { RecoverPage } from "./pages/RecoverPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UnlockPage } from "./pages/UnlockPage";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-4 text-center text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Logo className="size-12" />
      {children}
    </main>
  );
}

/**
 * Chooses between the sign-in screens, the unlock screen (end-to-end accounts whose key this browser does not hold)
 * and the app, then routes within the app.
 */
export function App() {
  const status = useAuthStatus();
  const { path } = useLocation();
  const user = status.data?.user ?? null;
  const keys = useEndToEndKeys(user);
  const signedOut = status.data !== undefined && !status.data.user;

  // A key saved during a session that has ended cannot be opened any more; remove it.
  useEffect(() => {
    if (signedOut) void e2ee.forget();
  }, [signedOut]);

  if (status.isPending) {
    return (
      <FullScreen>
        <Spinner className="size-6 text-maple-600" />
      </FullScreen>
    );
  }

  if (status.isError) {
    return (
      <FullScreen>
        <p>Maple Notes cannot reach its server right now.</p>
        <Button variant="secondary" onClick={() => void status.refetch()}>
          Try again
        </Button>
      </FullScreen>
    );
  }

  const { setupRequired, registrationOpen } = status.data;
  // Reachable signed in or out: finishing a reset signs in, and the new recovery key must stay on screen until saved.
  if (path === "/recover" && !setupRequired) {
    return <RecoverPage />;
  }

  if (!user) {
    const mode = setupRequired ? "setup" : path === "/register" && registrationOpen ? "register" : "login";
    return <AuthPage mode={mode} registrationOpen={registrationOpen} />;
  }

  if (keys.status === "checking") {
    return (
      <FullScreen>
        <Spinner className="size-6 text-maple-600" />
      </FullScreen>
    );
  }

  if (keys.status === "locked") {
    return <UnlockPage user={user} />;
  }

  return (
    <AppShell user={user}>
      {path === "/archive" ? <ArchivePage /> : path === "/settings" ? <SettingsPage user={user} /> : <HomePage />}
    </AppShell>
  );
}
