import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { BrandMark } from "./components/BrandMark";
import { DeviceNotebookChoice } from "./components/DeviceNotebookChoice";
import { Button, Spinner } from "./components/ui";
import { api } from "./lib/api";
import { useAppearance } from "./lib/appearance";
import { applyBranding, useBranding } from "./lib/branding";
import { useConversionRunner } from "./lib/conversion";
import { e2ee, useEndToEndKeys } from "./lib/e2ee";
import { onFirstWorkerControl, registerServiceWorker } from "./lib/mediaWorker";
import { forgetMode, TrustedModeContext, useTrustedMode } from "./lib/modeRecord";
import { setContentSession } from "./lib/noteCrypto";
import { useOffline } from "./lib/offline";
import { setOutboxOwner } from "./lib/outbox";
import { hasWebCrypto } from "./lib/secureContext";
import { queryKeys, useAuthStatus, useSignedOut } from "./lib/queries";
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
import { TrashPage } from "./pages/TrashPage";
import { UnlockPage } from "./pages/UnlockPage";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-4 text-center text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <BrandMark className="size-12" />
      {children}
    </main>
  );
}

/**
 * Shown instead of the app when the server says an account has no end-to-end key although this browser last saw it in
 * end-to-end mode. That is what turning end-to-end encryption off on another device looks like, but also what a
 * compromised server would do to make the app send new notes unencrypted, so the owner confirms before writing anything.
 */
function EndToEndGone({ userId }: { userId: string }) {
  const { appName } = useBranding();
  const signedOut = useSignedOut();
  return (
    <div role="alertdialog" aria-labelledby="e2ee-gone-title" className="flex max-w-md flex-col gap-3 text-left">
      <h1 id="e2ee-gone-title" className="text-center text-xl font-semibold">
        End-to-end encryption is off
      </h1>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        The server says this account no longer uses end-to-end encryption, so from now on {appName} would send what you
        write without encrypting it in your browser. This browser last saw the account end-to-end encrypted.
      </p>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        If you turned it off on another device, continue. If you did not, do not write anything: your server may have
        been tampered with. Sign out and tell its administrator.
      </p>
      <div className="flex justify-center gap-2">
        <Button
          onClick={() => {
            forgetMode(userId);
            window.location.reload();
          }}
        >
          I turned it off
        </Button>
        <Button variant="secondary" onClick={() => void api.logout().finally(signedOut)}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Shown instead of the app on a plain-HTTP page, where the browser offers no Web Crypto (see lib/secureContext.ts). */
function InsecureConnection() {
  const port = window.location.port ? `:${window.location.port}` : "";
  const { appName } = useBranding();
  return (
    <div className="flex max-w-md flex-col gap-3 text-left">
      <h1 className="text-center text-xl font-semibold">{appName} needs a secure connection</h1>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        This page was opened over plain HTTP at <strong>{window.location.host}</strong>. {appName} encrypts your password
        and notes in your browser, and browsers only allow that on HTTPS pages, or on the server itself as{" "}
        <code>localhost</code>. So signing in cannot work at this address.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
        <li>
          Open {appName} through <strong>HTTPS</strong>, for example behind a reverse proxy such as Caddy, Nginx Proxy
          Manager or Traefik (the README shows a complete setup).
        </li>
        <li>
          Or, on the computer running it, open <code>http://localhost{port}</code>.
        </li>
      </ul>
    </div>
  );
}

/** Shown when the app opens without a connection and has nothing saved to show. */
function CannotReachServer({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  const { appName } = useBranding();
  return (
    <>
      <p>{offline ? "You are offline." : `${appName} cannot reach its server right now.`}</p>
      {offline && (
        <p className="max-w-md text-sm text-stone-600 dark:text-stone-300">
          Notes you read recently open without a connection only on a device where you signed in with “Keep me signed
          in”.
        </p>
      )}
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
      {/* A notebook kept on this device needs no server. */}
      <div className="mt-4 text-sm text-stone-600 dark:text-stone-300">
        <DeviceNotebookChoice allowed={false} appName={appName} />
      </div>
    </>
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
  const branding = useBranding();
  const { appName, iconUrl } = branding;
  useEffect(() => applyBranding({ appName, iconUrl }), [appName, iconUrl]);
  const keys = useEndToEndKeys(user);
  const signedOut = status.data !== undefined && !status.data.user;
  const client = useQueryClient();
  const offline = useOffline();

  // The mode this browser encrypts for: the server's word is not enough to leave end-to-end mode (lib/modeRecord.ts).
  const trusted = useTrustedMode(user, keys);

  // Converts existing content to or from end-to-end encryption while the app is open (lib/conversion.ts).
  useConversionRunner(user, keys.status === "unlocked", trusted?.mode);

  // A key saved during a session that has ended cannot be opened any more; remove it.
  useEffect(() => {
    if (!signedOut) return;
    setContentSession(null);
    setOutboxOwner(null);
    void e2ee.forget();
  }, [signedOut]);

  // The service worker saves what the account reads for offline use (src/sw/offline.ts). When it first takes over, the
  // status is fetched again through it, which tells it whose reads to keep, and then everything shown, to save it.
  useEffect(() => {
    registerServiceWorker();
    return onFirstWorkerControl(() => {
      void client
        .refetchQueries({ queryKey: queryKeys.status })
        .then(() => client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth" }));
    });
  }, [client]);

  // Unlocking offline needs the password settings and the wrapped key, which a session that restored its key never
  // asks for: fetch them once per visit, through the worker, which keeps them when this device keeps notes.
  const unlockSaved = useRef<string | null>(null);
  const keepsNotes = status.data?.sessionPersistent === true && user?.hasEndToEndKey === true && keys.status === "unlocked";
  useEffect(() => {
    if (!keepsNotes || !user || offline || unlockSaved.current === user.id) return;
    unlockSaved.current = user.id;
    void Promise.allSettled([api.prelogin(user.username), api.e2ee.key()]);
  }, [keepsNotes, user, offline]);

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
        <CannotReachServer offline={offline} onRetry={() => void status.refetch()} />
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
    return <AuthPage mode={mode} registrationOpen={registrationOpen} deviceNotebooks={status.data.deviceNotebooks === true} />;
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
  if (trusted?.warning === "key-missing") {
    setContentSession(null); // nothing is written until the owner confirms
    return (
      <FullScreen>
        <EndToEndGone userId={user.id} />
      </FullScreen>
    );
  }

  setContentSession({ userId: user.id, mode: trusted?.mode ?? user.encryptionMode, keys: keys.status === "unlocked" ? keys.keys : null });
  // Only a device that keeps notes for offline reading keeps changes made offline, under the same rules. A notebook on
  // the device needs no outbox, and must not claim it: changes an account made offline wait there for its next sign-in.
  setOutboxOwner(status.data.onDevice ? null : { userId: user.id, keepsNotes: status.data.sessionPersistent === true });

  return (
    <TrustedModeContext.Provider value={trusted}>
      <AppShell user={user}>
        {path === "/archive" ? (
          <ArchivePage />
        ) : path === "/settings" || path.startsWith("/settings/") ? (
          <SettingsPage user={user} />
        ) : path === "/trash" ? (
          <TrashPage />
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
    </TrustedModeContext.Provider>
  );
}
