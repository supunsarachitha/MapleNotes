import type { ReactNode } from "react";

/**
 * The page's main actions, fixed at the bottom of a phone's screen within reach of the thumb (clear of the home
 * indicator); on wide screens, where the side menu shows, they sit under the page instead.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none dark:border-stone-800 dark:bg-stone-900/95 lg:dark:bg-transparent">
      <div className="mx-auto flex max-w-2xl gap-2">{children}</div>
    </div>
  );
}
