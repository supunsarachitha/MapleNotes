import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Logo } from "../components/Logo";
import { Button, ErrorMessage, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { queryKeys } from "../lib/queries";
import { Link, navigate } from "../lib/router";

export type AuthMode = "setup" | "login" | "register";

const titles: Record<AuthMode, { heading: string; intro: string; action: string }> = {
  setup: {
    heading: "Welcome to Maple Notes",
    intro: "Create the first account. It becomes the administrator of this instance.",
    action: "Create account",
  },
  login: { heading: "Sign in", intro: "Your notes, on your own server.", action: "Sign in" },
  register: { heading: "Create an account", intro: "Join this Maple Notes instance.", action: "Create account" },
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
  const text = titles[mode];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api.login(username, password, rememberMe);
      else await api.register(username, password, displayName || undefined);
      navigate("/", { replace: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.status });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const generalError = error && !error.fieldError("username") && !error.fieldError("password") ? error.message : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">{text.heading}</h1>
          <p className="text-sm text-stone-600 dark:text-stone-300">{text.intro}</p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
        >
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
            minLength={mode === "login" ? undefined : 10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error?.fieldError("password")}
            hint={mode !== "login" ? "At least 10 characters. A few random words work well." : undefined}
          />
          {mode === "login" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="size-4 accent-maple-600"
              />
              Keep me signed in for 30 days
            </label>
          )}
          <Button type="submit" busy={busy} className="mt-1 h-11">
            {text.action}
          </Button>
        </form>

        {mode === "login" && registrationOpen && (
          <p className="mt-4 text-center text-sm text-stone-600 dark:text-stone-300">
            New here?{" "}
            <Link href="/register" className="font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400">
              Create an account
            </Link>
          </p>
        )}
        {mode === "register" && (
          <p className="mt-4 text-center text-sm text-stone-600 dark:text-stone-300">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
