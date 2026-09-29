import { useId, type ComponentProps, type ReactNode } from "react";

/** Joins class names, skipping falsy values. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-maple-600 text-white hover:bg-maple-700",
  secondary:
    "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
  ghost: "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        buttonVariants[variant],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** A round, icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-stone-600 transition-colors",
        "hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-700 dark:text-stone-200">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-11 rounded-xl border bg-white px-3 text-base text-stone-900 placeholder:text-stone-400",
          "dark:bg-stone-950 dark:text-stone-100",
          error ? "border-red-600" : "border-stone-300 dark:border-stone-700",
          focusRing,
        )}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-stone-500 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An accessible on/off switch (role="switch"). */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** ID of the element that explains the switch. */
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-maple-600" : "bg-stone-300 dark:bg-stone-700",
        focusRing,
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A settings card: a heading, an optional description and its controls. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {children}
    </p>
  );
}
