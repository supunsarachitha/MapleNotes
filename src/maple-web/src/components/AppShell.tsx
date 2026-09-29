import * as Dialog from "@radix-ui/react-dialog";
import { Archive, Hash, Home, ListTodo, LogOut, Menu, Search, Settings, X, Zap } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useEnabledKinds } from "../lib/kinds";
import { usePreferences } from "../lib/preferences";
import { useSignedOut, useTags } from "../lib/queries";
import { Link, navigate, useLocation } from "../lib/router";
import type { User } from "../lib/types";
import { Calendar } from "./Calendar";
import { Logo } from "./Logo";
import { useToast } from "./Toaster";
import { IconButton, cn } from "./ui";

function NavLink({ href, icon: Icon, children, active, onNavigate }: {
  href: string;
  icon: typeof Home;
  children: ReactNode;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
        active
          ? "bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400"
          : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {children}
    </Link>
  );
}

function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const { params } = useLocation();
  const [value, setValue] = useState(params.get("q") ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = value.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
    onNavigate?.();
  }

  return (
    <form role="search" onSubmit={submit} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search notes"
        aria-label="Search notes"
        className="h-10 w-full rounded-full border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm outline-none focus:border-maple-500 focus:bg-white dark:border-stone-700 dark:bg-stone-800 dark:focus:bg-stone-900"
      />
    </form>
  );
}

function Sidebar({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const { path, params } = useLocation();
  const preferences = usePreferences();
  const tags = useTags(useEnabledKinds());
  const signedOut = useSignedOut();
  const toast = useToast();
  const activeTag = params.get("tag");

  async function signOut() {
    try {
      await api.logout();
      navigate("/", { replace: true });
      signedOut();
    } catch {
      toast.error("Could not sign out. Please try again.");
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-1">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">Maple Notes</span>
      </Link>

      <SearchBox onNavigate={onNavigate} />

      <nav aria-label="Main" className="flex flex-col gap-1">
        <NavLink href="/" icon={Home} active={path === "/" && !activeTag && !params.get("q") && !params.get("day")} onNavigate={onNavigate}>
          Home
        </NavLink>
        {preferences.todoLists && (
          <NavLink href="/todo" icon={ListTodo} active={path === "/todo"} onNavigate={onNavigate}>
            Todo
          </NavLink>
        )}
        {preferences.quickNotes && (
          <NavLink href="/quick" icon={Zap} active={path === "/quick"} onNavigate={onNavigate}>
            Quick notes
          </NavLink>
        )}
        <NavLink href="/archive" icon={Archive} active={path === "/archive"} onNavigate={onNavigate}>
          Archive
        </NavLink>
        <NavLink href="/settings" icon={Settings} active={path === "/settings"} onNavigate={onNavigate}>
          Settings
        </NavLink>
      </nav>

      {preferences.calendar && <Calendar onNavigate={onNavigate} />}

      {tags.data && tags.data.length > 0 && (
        <nav aria-label="Tags" className="flex min-h-0 flex-1 flex-col">
          <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Tags</h2>
          <ul className="-mx-1 flex flex-col overflow-y-auto px-1">
            {tags.data.map((tag) => (
              <li key={tag.name}>
                <Link
                  href={`/?tag=${encodeURIComponent(tag.name)}`}
                  onClick={onNavigate}
                  aria-current={activeTag === tag.name ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg px-3 text-sm",
                    activeTag === tag.name
                      ? "bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
                  )}
                >
                  <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tag.name}</span>
                  <span className="ml-auto text-xs text-stone-400">{tag.noteCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-maple-100 text-sm font-semibold uppercase text-maple-700 dark:bg-maple-600/20 dark:text-maple-400"
        >
          {user.displayName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.displayName}</p>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">@{user.username}</p>
        </div>
        <IconButton label="Sign out" onClick={() => void signOut()}>
          <LogOut className="size-5" />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * The signed-in layout. Phones: a top bar with a slide-in navigation drawer. Wide screens (≥1024 px): a fixed
 * sidebar next to a centred reading column.
 */
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stone-200 bg-white/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-900/90">
        <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-6" />
        </IconButton>
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="font-semibold">Maple Notes</span>
        </Link>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 border-r border-stone-200 bg-white lg:block dark:border-stone-800 dark:bg-stone-900">
          <Sidebar user={user} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:px-10 lg:pt-8">
          <div className="mx-auto max-w-2xl">{children}</div>
        </main>
      </div>

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] bg-white shadow-xl lg:hidden dark:bg-stone-900"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close navigation" className="absolute right-2 top-3">
                <X className="size-5" />
              </IconButton>
            </Dialog.Close>
            <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
