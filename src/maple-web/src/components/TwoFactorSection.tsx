import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { encode } from "uqr";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/auth";
import { queryKeys } from "../lib/queries";
import type { TwoFactorSetup, User } from "../lib/types";
import { useToast } from "./Toaster";
import { Button, ErrorMessage, Section, TextField } from "./ui";

const twoFactorKey = ["account", "two-factor"] as const;

/** The setup link as a QR code, drawn as one SVG path so it stays sharp at any size and in print. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="size-48 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

/** A secret written in groups of four, which is how people type it into an app. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const text = codes.join("\n");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Each code signs you in once if you lose your phone. Keep them somewhere safe, apart from your password. You will
        not see them again.
      </p>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-3 font-mono text-sm dark:bg-stone-800">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => toast.info("Recovery codes copied."))
              .catch(() => toast.error("Could not copy. Select the codes and copy them instead."))
          }
        >
          Copy
        </Button>
        <Button onClick={onDone}>I saved them</Button>
      </div>
    </div>
  );
}

function DialogShell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900"
        >
          <Dialog.Title className="mb-4 text-lg font-semibold">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Adds the account to an authenticator app, checks a code from it, then shows the recovery codes once. */
function EnableDialog({ user, open, onOpenChange }: { user: User; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const setup = useQuery<TwoFactorSetup>({ queryKey: ["two-factor-setup"], queryFn: api.twoFactor.setup, enabled: open, gcTime: 0, staleTime: Infinity });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  function change(next: boolean) {
    if (!next) {
      setCode("");
      setPassword("");
      setError(null);
      setCodes(null);
      queryClient.removeQueries({ queryKey: ["two-factor-setup"] });
      if (codes) void queryClient.invalidateQueries({ queryKey: queryKeys.status });
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!setup.data) return;
    setBusy(true);
    setError(null);
    try {
      const proof = await auth.proveIdentity(user.username, password);
      setCodes(await api.twoFactor.enable({ proof, secret: setup.data.secret, code: code.trim() }));
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: twoFactorKey });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell open={open} onOpenChange={change} title={codes ? "Save your recovery codes" : "Turn on two-factor sign-in"}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => change(false)} />
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Scan this code with an authenticator app, such as Aegis, 2FAS, Google Authenticator or a password manager. On
            this phone, open the link instead.
          </p>
          {setup.data ? (
            <div className="flex flex-col items-center gap-2">
              <QrCode value={setup.data.uri} label="QR code to add this account to an authenticator app" />
              <a href={setup.data.uri} className="text-sm font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400">
                Open in authenticator app
              </a>
              <p className="text-center text-xs text-stone-500 dark:text-stone-400">
                Or type this key: <span className="select-all font-mono text-stone-700 dark:text-stone-200">{grouped(setup.data.secret)}</span>
              </p>
            </div>
          ) : setup.isError ? (
            <ErrorMessage>{setup.error instanceof ApiError ? setup.error.message : "Could not start the setup."}</ErrorMessage>
          ) : (
            <div className="mx-auto size-48 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800" aria-busy="true" aria-label="Loading" />
          )}
          {error && !error.fieldError("code") && !error.fieldError("password") && <ErrorMessage>{error.message}</ErrorMessage>}
          <TextField
            label="Code from the app"
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={error?.fieldError("code")}
          />
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error?.fieldError("password")}
          />
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button type="submit" busy={busy} disabled={!setup.data || !code || !password}>
              Turn on
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

/** Asks for both factors before turning two-factor sign-in off or replacing the recovery codes. */
function ConfirmDialog({
  user,
  action,
  onOpenChange,
}: {
  user: User;
  action: "disable" | "codes" | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  function change(next: boolean) {
    if (!next) {
      setCode("");
      setPassword("");
      setError(null);
      setCodes(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const proof = await auth.proveIdentity(user.username, password);
      if (action === "disable") {
        await api.twoFactor.disable({ proof, code: code.trim() });
        toast.info("Two-factor sign-in is off.");
        void queryClient.invalidateQueries({ queryKey: queryKeys.status });
        change(false);
      } else {
        setCodes(await api.twoFactor.replaceRecoveryCodes({ proof, code: code.trim() }));
        setPassword("");
      }
      void queryClient.invalidateQueries({ queryKey: twoFactorKey });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, { title: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const title = codes ? "Save your new recovery codes" : action === "disable" ? "Turn off two-factor sign-in?" : "Create new recovery codes?";
  return (
    <DialogShell open={action !== null} onOpenChange={change} title={title}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => change(false)} />
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            {action === "disable"
              ? "Signing in will need only your password again."
              : "Your current recovery codes stop working. You will see the new ones once."}
          </p>
          {error && !error.fieldError("code") && !error.fieldError("password") && <ErrorMessage>{error.message}</ErrorMessage>}
          <TextField
            label="Code from your app, or a recovery code"
            autoComplete="one-time-code"
            autoFocus
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={error?.fieldError("code")}
          />
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error?.fieldError("password")}
          />
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button type="submit" variant={action === "disable" ? "danger" : "primary"} busy={busy} disabled={!code || !password}>
              {action === "disable" ? "Turn off" : "Create"}
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

/** Settings → Privacy & security: optional two-factor sign-in with an authenticator app. */
export function TwoFactorSection({ user }: { user: User }) {
  const status = useQuery({ queryKey: [...twoFactorKey, user.twoFactorEnabled ?? false], queryFn: api.twoFactor.status });
  const [enabling, setEnabling] = useState(false);
  const [action, setAction] = useState<"disable" | "codes" | null>(null);
  const enabled = status.data?.enabled ?? user.twoFactorEnabled ?? false;
  const left = status.data?.recoveryCodesLeft;

  return (
    <Section
      title="Two-factor sign-in"
      description="Optional. Signing in then needs a code from an authenticator app on your phone as well as your password, so a stolen password alone is not enough."
    >
      {enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">On.</span>{" "}
            {left !== undefined && (
              <span className={left <= 2 ? "text-red-700 dark:text-red-400" : "text-stone-600 dark:text-stone-300"}>
                {left === 1 ? "1 recovery code left." : `${left} recovery codes left.`}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAction("codes")}>
              New recovery codes…
            </Button>
            <Button variant="secondary" onClick={() => setAction("disable")}>
              Turn off…
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setEnabling(true)}>
          Turn on two-factor sign-in…
        </Button>
      )}
      <EnableDialog user={user} open={enabling} onOpenChange={setEnabling} />
      <ConfirmDialog user={user} action={action} onOpenChange={(open) => !open && setAction(null)} />
    </Section>
  );
}
