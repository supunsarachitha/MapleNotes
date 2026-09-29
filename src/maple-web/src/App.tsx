import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { Logo } from "./components/Logo";
import { Button, Spinner } from "./components/ui";
import { useAuthStatus } from "./lib/queries";
import { useLocation } from "./lib/router";
import { AuthPage } from "./pages/AuthPage";
import { ArchivePage, HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-4 text-center text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Logo className="size-12" />
      {children}
    </main>
  );
}

/** Chooses between the sign-in screens and the app, then routes within the app. */
export function App() {
  const status = useAuthStatus();
  const { path } = useLocation();

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

  const { user, setupRequired, registrationOpen } = status.data;
  if (!user) {
    const mode = setupRequired ? "setup" : path === "/register" && registrationOpen ? "register" : "login";
    return <AuthPage mode={mode} registrationOpen={registrationOpen} />;
  }

  return (
    <AppShell user={user}>
      {path === "/archive" ? <ArchivePage /> : path === "/settings" ? <SettingsPage user={user} /> : <HomePage />}
    </AppShell>
  );
}
