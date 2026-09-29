import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** The centered card used by the sign-in, unlock and recovery screens. */
export function AuthLayout({
  heading,
  intro,
  children,
  footer,
}: {
  heading: string;
  intro: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-sm text-stone-600 dark:text-stone-300">{intro}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-sm text-stone-600 dark:text-stone-300">{footer}</div>}
      </div>
    </main>
  );
}

export const linkClass = "font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400";
