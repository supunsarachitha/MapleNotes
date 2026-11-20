import { useQuery } from "@tanstack/react-query";
import { retentionText } from "./TrashPage";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  DatabaseBackup,
  FileStack,
  Info,
  Palette,
  PanelLeft,
  PenLine,
  Server,
  ShieldCheck,
  Tag,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AboutSection } from "../components/AboutSection";
import {
  DeleteAccountSection,
  DeleteContentSection,
  PasswordSection,
  ProfileSection,
  RecoverySection,
  SessionsSection,
  StorageSection,
} from "../components/AccountSections";
import { AdminSection } from "../components/AdminSettings";
import { AuditLogSection } from "../components/AuditLogSection";
import { EncryptionSection } from "../components/EncryptionSection";
import { ExportSection } from "../components/ExportSection";
import { LabelSettings } from "../components/LabelSettings";
import { BudgetsSection } from "../components/BudgetParts";
import { AppearanceSection, EditingSection, MenuSection, NotesFilesSection, WritingExtrasSection, WritingSection } from "../components/PreferenceSections";
import { NotificationsSection } from "../components/NotificationsSection";
import { PasskeysSection } from "../components/PasskeysSection";
import { TwoFactorSection } from "../components/TwoFactorSection";
import { VersionNote } from "../components/VersionNote";
import { cn, Section, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import { Link, useLocation } from "../lib/router";
import type { User } from "../lib/types";


/** Where the trash is, since it is not in the side menu, and whether deleting uses it. */
function TrashSection() {
  const { trash, trashDays } = usePreferences();
  return (
    <Section
      title="Trash"
      description={
        trash
          ? trashDays > 0
            ? `Deleted notes, todo lists and habits wait in the trash for ${retentionText(trashDays)}, then they are deleted for good.`
            : "Deleted notes, todo lists and habits wait in the trash until you empty it."
          : "The trash is turned off in Notes & files: deleting is immediate and permanent."
      }
    >
      <Link
        href="/trash"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
      >
        <Trash2 className="size-4" aria-hidden="true" /> Open the trash
      </Link>
    </Section>
  );
}

interface SettingsSection {
  id: string;
  title: string;
  /** What the section holds, under its title in the list on phones and on its page. */
  summary: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Shown only while this feature is turned on. */
  feature?: "budgets";
}

/** The sections of Settings, in the order of the list; each has its own address, /settings/{id}. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "account", title: "Account", summary: "Your name, how much you store, and deleting your account.", icon: CircleUserRound },
  { id: "appearance", title: "Appearance", summary: "Light or dark, the accent colour, the first day of the week and the menu's text size.", icon: Palette },
  { id: "menu", title: "Side menu", summary: "Which pages the menu shows, in what order, and the calendar.", icon: PanelLeft },
  { id: "writing", title: "Writing", summary: "Titles, dates, editing, daily notes, moods and stickers.", icon: PenLine },
  { id: "notes", title: "Notes & files", summary: "The trash, photo uploads and link previews.", icon: FileStack },
  { id: "notifications", title: "Notifications", summary: "Reminders as notifications on this device and your others.", icon: Bell },
  { id: "budgets", title: "Budgets", summary: "Your currency and how forecasts are worked out.", icon: Wallet, feature: "budgets" },
  { id: "labels", title: "Labels", summary: "Coloured labels for your notes.", icon: Tag },
  { id: "data", title: "Backup & data", summary: "Export, restore, the trash and starting over.", icon: DatabaseBackup },
  { id: "security", title: "Privacy & security", summary: "Your password, two-factor sign-in, encryption, recovery key and sessions.", icon: ShieldCheck },
  { id: "admin", title: "Administration", summary: "Accounts, sign-ups, storage, this server's name and the audit log.", icon: Server, adminOnly: true },
  { id: "about", title: "About", summary: "Which version this is, and checking that your browser got the genuine app.", icon: Info },
];

function SectionContent({ id, user }: { id: string; user: User }) {
  switch (id) {
    case "appearance":
      return <AppearanceSection />;
    case "menu":
      return <MenuSection />;
    case "writing":
      return (
        <>
          <WritingSection />
          <EditingSection />
          <WritingExtrasSection />
        </>
      );
    case "notes":
      return <NotesFilesSection />;
    case "labels":
      return <LabelSettings />;
    case "budgets":
      return <BudgetsSection />;
    case "data":
      return (
        <>
          <ExportSection user={user} />
          <TrashSection />
          <DeleteContentSection username={user.username} />
        </>
      );
    case "notifications":
      return <NotificationsSection />;
    case "security":
      return (
        <>
          <PasswordSection user={user} />
          <TwoFactorSection user={user} />
          <PasskeysSection user={user} />
          <EncryptionSection user={user} />
          {user.hasEndToEndKey && <RecoverySection user={user} />}
          <SessionsSection />
        </>
      );
    case "about":
      return <AboutSection />;
    case "admin":
      return (
        <>
          <AdminSection currentUserId={user.id} />
          <AuditLogSection />
        </>
      );
    default:
      return (
        <>
          <ProfileSection user={user} />
          <StorageSection />
          <DeleteAccountSection username={user.username} />
        </>
      );
  }
}

/**
 * Settings, in sections. Wide screens show the sections' list beside the open one (Account at first). Phones show
 * the list, and each section on its own page with a way back. Each section has its own address, so the browser's
 * Back button and links (from Help, for example) work.
 */
export function SettingsPage({ user }: { user: User }) {
  const { path } = useLocation();
  const preferences = usePreferences();
  const sections = SETTINGS_SECTIONS.filter(
    (section) => (!section.adminOnly || user.role === "Admin") && (!section.feature || preferences[section.feature]),
  );
  const asked = path.startsWith("/settings/") ? path.slice("/settings/".length) : null;
  // Features was split up; its old address opens the section that kept most of it.
  const requested = asked === "features" ? "notes" : asked;
  const current = sections.find((section) => section.id === requested) ?? null;
  const shown = current ?? sections[0]!;
  // A conversion after a change of encryption shows in the list, wherever one is.
  const encryption = useQuery({ queryKey: queryKeys.encryption, queryFn: api.encryption });
  const converting = encryption.data?.inProgress === true;

  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:items-start md:gap-8">
      <div className={cn("flex flex-col gap-3 md:sticky md:top-8", current && "hidden md:flex")}>
        {current ? (
          <p className="px-1 text-xl font-semibold" aria-hidden="true">
            Settings
          </p>
        ) : (
          <h1 className="px-1 text-xl font-semibold">Settings</h1>
        )}
        <nav aria-label="Settings sections">
          <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm md:flex md:flex-col md:gap-0.5 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none dark:border-stone-800 dark:bg-stone-900 md:dark:bg-transparent">
            {sections.map(({ id, title, summary, icon: Icon }) => {
              const active = id === shown.id;
              return (
                <li key={id} className="border-b border-stone-100 last:border-b-0 md:border-0 dark:border-stone-800">
                  <Link
                    href={`/settings/${id}`}
                    aria-current={current && active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-stone-50 md:min-h-10 md:rounded-xl md:px-3 md:py-2 dark:hover:bg-stone-800",
                      active &&
                        "md:bg-white md:font-medium md:text-maple-700 md:shadow-sm md:hover:bg-white dark:md:bg-stone-900 dark:md:text-maple-400",
                    )}
                  >
                    <Icon className="size-5 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] md:text-sm">{title}</span>
                      <span className="block text-xs text-stone-500 md:hidden dark:text-stone-400">{summary}</span>
                    </span>
                    {id === "security" && converting && <Spinner className="size-4 shrink-0 text-maple-600" />}
                    {id === "security" && converting && <span className="sr-only">(converting your notes)</span>}
                    <ChevronRight className="size-4 shrink-0 text-stone-400 md:hidden" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <VersionNote />
      </div>

      <div className={cn("flex min-w-0 flex-col gap-4", !current && "hidden md:flex")}>
        <div>
          <Link
            href="/settings"
            className="-ml-2 mb-2 inline-flex h-9 items-center gap-1 rounded-full px-2 text-sm text-stone-600 hover:bg-stone-200 md:hidden dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> Settings
          </Link>
          {current ? <h1 className="text-xl font-semibold">{shown.title}</h1> : <h2 className="text-xl font-semibold">{shown.title}</h2>}
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{shown.summary}</p>
        </div>
        <SectionContent key={shown.id} id={shown.id} user={user} />
      </div>
    </div>
  );
}
