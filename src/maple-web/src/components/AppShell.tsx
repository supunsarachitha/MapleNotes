import * as Dialog from "@radix-ui/react-dialog";
import { Home, LogOut, Menu, Search, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useBranding } from "../lib/branding";
import { useEnabledKinds } from "../lib/kinds";
import { MENU_INFO, menuOrder, type MenuItemId } from "../lib/menu";
import { usePreferences } from "../lib/preferences";
import { useLabels, useSignedOut, useTags } from "../lib/queries";
import { Link, navigate, useLocation, type Location } from "../lib/router";
import type { User } from "../lib/types";
import { Calendar } from "./Calendar";
import { BrandMark } from "./BrandMark";
import { LabelDot } from "./Labels";
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
        "flex h-(--menu-row) items-center gap-3 rounded-xl px-3 text-(length:--menu-text) font-medium transition-colors",
        active
          ? "bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400"
          : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
      )}
    >
      <Icon className="size-(--menu-icon) shrink-0" aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Whether a menu item is the page being shown. Settings stays marked on the trash, which is reached from it. */
function isActive(item: MenuItemId, { path, params }: Location): boolean {
  const filtered = ["tag", "q", "day", "label"].some((name) => params.has(name));
  switch (item) {
    case "home":
      return path === "/" && !filtered;
    case "tags":
      return path === "/tags" || (path === "/" && params.has("tag"));
    case "settings":
      return path === "/settings" || path.startsWith("/settings/") || path === "/trash";
    default:
      return path === MENU_INFO[item].href;
  }
}

/** The account's labels with how many notes carry each, under the menu; each lists its notes. */
function LabelLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { params } = useLocation();
  const labels = useLabels(useEnabledKinds());
  if (!labels.data || labels.data.length === 0) return null;
  const active = params.get("label");
  return (
    <nav aria-label="Labels" className="flex flex-col gap-0.5">
      <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Labels</h2>
      {labels.data.map((label) => (
        <Link
          key={label.id}
          href={`/?label=${encodeURIComponent(label.id)}`}
          onClick={onNavigate}
          aria-current={active === label.id ? "page" : undefined}
          className={cn(
            "flex min-h-9 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
            active === label.id
              ? "bg-maple-50 font-medium text-maple-700 dark:bg-maple-600/15 dark:text-maple-400"
              : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
          )}
        >
          <LabelDot color={label.color} className="ml-1 size-3" />
          <span className="min-w-0 flex-1 truncate">{label.name}</span>
          {label.noteCount > 0 && <span className="text-xs text-stone-400">{label.noteCount}</span>}
        </Link>
      ))}
    </nav>
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
  const location = useLocation();
  const preferences = usePreferences();
  const tags = useTags(useEnabledKinds(), preferences.tags);
  const signedOut = useSignedOut();
  const { appName } = useBranding();
  const toast = useToast();
  const items = menuOrder(preferences.menuOrder).filter((item) => MENU_INFO[item].shown(preferences));

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
    <div className="flex h-full flex-col" data-menu={preferences.menuTextSize.toLowerCase()}>
      <div className="flex flex-col gap-4 p-4 pb-3 short:gap-3 short:pb-2">
        <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-3 px-1">
          <BrandMark className="size-9 shrink-0" />
          <span className="truncate text-lg font-semibold tracking-tight">{appName}</span>
        </Link>

        <SearchBox onNavigate={onNavigate} />
      </div>

      {/* The menu and the calendar scroll when the window is too short for them; the account row below always shows. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-1 short:gap-2">
        <nav aria-label="Main" className="flex flex-col gap-1 short:gap-0">
          {items.map((item) => {
            const { label, href, icon } = MENU_INFO[item];
            return (
              <NavLink key={item} href={href} icon={icon} active={isActive(item, location)} onNavigate={onNavigate}>
                {label}
                {item === "tags" && tags.data && tags.data.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-stone-400">{tags.data.length}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {preferences.labels && <LabelLinks onNavigate={onNavigate} />}

        {preferences.calendar && <Calendar onNavigate={onNavigate} />}
      </div>

      <div className="mx-4 mb-4 mt-3 flex items-center gap-3 border-t border-stone-200 pt-4 short:mb-3 short:mt-2 short:pt-3 dark:border-stone-800">
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
  const { appName } = useBranding();
  const { path } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Settings lists its sections beside the open one, so it gets a wider column than the notes.
  const wide = path === "/settings" || path.startsWith("/settings/");

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stone-200 bg-white/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-900/90">
        <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-6" />
        </IconButton>
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <BrandMark className="size-7 shrink-0" />
          <span className="truncate font-semibold">{appName}</span>
        </Link>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 border-r border-stone-200 bg-white lg:block dark:border-stone-800 dark:bg-stone-900">
          <Sidebar user={user} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:px-10 lg:pt-8">
          <div className={cn("mx-auto", wide ? "max-w-4xl" : "max-w-2xl")}>{children}</div>
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
