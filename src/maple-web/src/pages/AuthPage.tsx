import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AuthLayout, linkClass } from "../components/AuthLayout";
import { Button, ErrorMessage, TextField } from "../components/ui";
import { ApiError } from "../lib/api";
import { auth, MIN_PASSWORD_LENGTH, TwoFactorRequired, validateNewPassword } from "../lib/auth";
import { useBranding } from "../lib/branding";
import { queryKeys } from "../lib/queries";
import { Link, navigate } from "../lib/router";

export type AuthMode = "setup" | "login" | "register";

const titles: Record<AuthMode, { heading: string; intro: string; action: string }> = {
  setup: {
    heading: "Welcome to {app}",
    intro: "Create the first account. It becomes the administrator of this instance.",
    action: "Create account",
  },
  login: { heading: "Sign in", intro: "Your notes, on your own server.", action: "Sign in" },
  register: { heading: "Create an account", intro: "Join {app}.", action: "Create account" },
};

/** First-run setup, sign-in and registration. */
export function AuthPage({ mode, registrationOpen }: { mode: AuthMode; registrationOpen: boolean }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // With two-factor sign-in, the password was right and this finishes signing in with a code.
  const [challenge, setChallenge] = useState<TwoFactorRequired | null>(null);
  const [code, setCode] = useState("");
  const { appName } = useBranding();
  const text = titles[mode];

  async function signedIn() {
    navigate("/", { replace: true });
    await queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await challenge.complete(code);
      await signedIn();
    } catch (caught) {
      setCode("");
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const weakPassword = mode === "login" ? null : validateNewPassword(password);
    if (weakPassword) {
      setError(new ApiError(400, { errors: { password: [weakPassword] } }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await auth.signIn(username, password, rememberMe);
      else await auth.register(username, password, displayName || undefined);
      await signedIn();
    } catch (caught) {
      if (caught instanceof TwoFactorRequired) {
        setPassword("");
        setChallenge(caught);
        return;
      }
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const generalError = error && !error.fieldError("username") && !error.fieldError("password") ? error.message : null;

  if (challenge) {
    return (
      <AuthLayout
        heading="Two-factor sign-in"
        intro="Enter the code your authenticator app shows for this account."
        footer={
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          >
            Back to sign in
          </button>
        }
      >
        <form onSubmit={(event) => void submitCode(event)} className="flex flex-col gap-4">
          {error && <ErrorMessage>{error.message}</ErrorMessage>}
          <TextField
            label="Authentication code"
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            hint="6 digits. Lost your phone? Enter one of your recovery codes instead."
          />
          <Button type="submit" busy={busy} className="mt-1 h-11">
            Sign in
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      heading={text.heading.replace("{app}", appName)}
      intro={text.intro.replace("{app}", appName)}
      footer={
        mode === "login" ? (
          <div className="flex flex-col gap-2">
            <Link href="/recover" className={linkClass}>
              Forgot your password?
            </Link>
            {registrationOpen && (
              <p>
                New here?{" "}
                <Link href="/register" className={linkClass}>
                  Create an account
                </Link>
              </p>
            )}
          </div>
        ) : mode === "register" ? (
          <p>
            Already have an account?{" "}
            <Link href="/login" className={linkClass}>
              Sign in
            </Link>
          </p>
        ) : undefined
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {generalError && <ErrorMessage>{generalError}</ErrorMessage>}
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={error?.fieldError("username")}
          hint={mode !== "login" ? "3–32 letters, digits, dots, dashes or underscores." : undefined}
        />
        {mode !== "login" && (
          <TextField
            label="Display name (optional)"
            name="displayName"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={error?.fieldError("displayName")}
          />
        )}
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "login" ? undefined : MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldError("password")}
          hint={
            mode !== "login"
              ? `At least ${MIN_PASSWORD_LENGTH} characters. A few random words work well. It never leaves this device.`
              : undefined
          }
        />
        {mode === "login" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="size-4 accent-maple-600"
            />
            Keep me signed in
          </label>
        )}
        <Button type="submit" busy={busy} className="mt-1 h-11">
          {text.action}
        </Button>
      </form>
    </AuthLayout>
  );
}
