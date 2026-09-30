import { useEffect, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { Logo } from "./components/Logo";
import { Button, Spinner } from "./components/ui";
import { useAppearance } from "./lib/appearance";
import { useConversionRunner } from "./lib/conversion";
import { e2ee, useEndToEndKeys } from "./lib/e2ee";
import { registerMediaWorker } from "./lib/mediaWorker";
import { setContentSession } from "./lib/noteCrypto";
import { hasWebCrypto } from "./lib/secureContext";
import { useAuthStatus } from "./lib/queries";
import { useLocation } from "./lib/router";
import { AuthPage } from "./pages/AuthPage";
import { ArchivePage, HomePage } from "./pages/HomePage";
import { RecoverPage } from "./pages/RecoverPage";
import { HabitsPage } from "./pages/HabitsPage";
import { HelpPage } from "./pages/HelpPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TagsPage } from "./pages/TagsPage";
import { QuickNotesPage } from "./pages/QuickNotesPage";
import { TodoPage } from "./pages/TodoPage";
import { UnlockPage } from "./pages/UnlockPage";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-4 text-center text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Logo className="size-12" />
      {children}
    </main>
  );
}

/** Shown instead of the app on a plain-HTTP page, where the browser offers no Web Crypto (see lib/secureContext.ts). */
function InsecureConnection() {
  const port = window.location.port ? `:${window.location.port}` : "";
  return (
    <div className="flex max-w-md flex-col gap-3 text-left">
      <h1 className="text-center text-xl font-semibold">Maple Notes needs a secure connection</h1>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        This page was opened over plain HTTP at <strong>{window.location.host}</strong>. Maple Notes encrypts your password
        and notes in your browser, and browsers only allow that on HTTPS pages, or on the server itself as{" "}
        <code>localhost</code>. So signing in cannot work at this address.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
        <li>
          Open Maple Notes through <strong>HTTPS</strong>, for example behind a reverse proxy such as Caddy, Nginx Proxy
          Manager or Traefik (the README shows a complete setup).
        </li>
        <li>
          Or, on the computer running it, open <code>http://localhost{port}</code>.
        </li>
      </ul>
    </div>
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
  useAppearance(user?.preferences.theme, user?.preferences.accent);
  const keys = useEndToEndKeys(user);
  const signedOut = status.data !== undefined && !status.data.user;
  const needsMediaWorker = user?.hasEndToEndKey === true;

  // Converts existing content to or from end-to-end encryption while the app is open (lib/conversion.ts).
  useConversionRunner(user, keys.status === "unlocked");

  // A key saved during a session that has ended cannot be opened any more; remove it.
  useEffect(() => {
    if (!signedOut) return;
    setContentSession(null);
    void e2ee.forget();
  }, [signedOut]);

  // Only accounts with end-to-end files need the media service worker.
  useEffect(() => {
    if (needsMediaWorker) registerMediaWorker();
  }, [needsMediaWorker]);

  if (!hasWebCrypto()) {
    return (
      <FullScreen>
        <InsecureConnection />
      </FullScreen>
    );
  }

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

  // Set while rendering, not in an effect: the note lists below start loading in their own effects, which run
  // before this component's, and must already encrypt and decrypt for this account. The assignment is idempotent.
  setContentSession({ userId: user.id, mode: user.encryptionMode, keys: keys.status === "unlocked" ? keys.keys : null });

  return (
    <AppShell user={user}>
      {path === "/archive" ? (
        <ArchivePage />
      ) : path === "/settings" ? (
        <SettingsPage user={user} />
      ) : path === "/todo" ? (
        <TodoPage />
      ) : path === "/quick" ? (
        <QuickNotesPage />
      ) : path === "/habits" ? (
        <HabitsPage />
      ) : path === "/tags" ? (
        <TagsPage />
      ) : path === "/help" ? (
        <HelpPage />
      ) : (
        <HomePage />
      )}
    </AppShell>
  );
}
