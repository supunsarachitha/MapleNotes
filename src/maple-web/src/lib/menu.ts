import { Archive, CalendarCheck, CircleHelp, Hash, Home, ListTodo, Settings, Zap, type LucideIcon } from "lucide-react";
import type { Preferences } from "./types";

/** The side menu's items in their default order (the server knows the same names). */
export const MENU_ITEMS = ["home", "todo", "quick", "habits", "tags", "archive", "settings", "help"] as const;
export type MenuItemId = (typeof MENU_ITEMS)[number];

export interface MenuItemInfo {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Whether the item shows, given the features the user has turned on. */
  shown: (preferences: Preferences) => boolean;
  /** The feature switch that hides it, if any. */
  feature?: string;
}

export const MENU_INFO: Record<MenuItemId, MenuItemInfo> = {
  home: { label: "Home", href: "/", icon: Home, shown: () => true },
  todo: { label: "Todo", href: "/todo", icon: ListTodo, shown: (p) => p.todoLists, feature: "Todo lists" },
  quick: { label: "Quick notes", href: "/quick", icon: Zap, shown: (p) => p.quickNotes, feature: "Quick notes" },
  habits: { label: "Habits", href: "/habits", icon: CalendarCheck, shown: (p) => p.habitTracker, feature: "Habit tracker" },
  tags: { label: "Tags", href: "/tags", icon: Hash, shown: (p) => p.tags, feature: "Tags page" },
  archive: { label: "Archive", href: "/archive", icon: Archive, shown: (p) => p.archive, feature: "Archive" },
  settings: { label: "Settings", href: "/settings", icon: Settings, shown: () => true },
  help: { label: "Help", href: "/help", icon: CircleHelp, shown: (p) => p.helpMenu, feature: "Help in the menu" },
};

const isMenuItem = (value: string): value is MenuItemId => (MENU_ITEMS as readonly string[]).includes(value);

/**
 * Every menu item in the order the user chose (`menuOrder`, comma-separated). Items it leaves out, such as ones added
 * in a later version, follow in their default order; unknown or repeated names are ignored.
 */
export function menuOrder(saved: string): MenuItemId[] {
  const chosen: MenuItemId[] = [];
  for (const item of saved.split(",")) {
    if (isMenuItem(item) && !chosen.includes(item)) chosen.push(item);
  }
  return [...chosen, ...MENU_ITEMS.filter((item) => !chosen.includes(item))];
}

/** The value to save for an order: empty when it is the default order, so later changes to the default apply. */
export function saveMenuOrder(order: MenuItemId[]): string {
  return order.join(",") === MENU_ITEMS.join(",") ? "" : order.join(",");
}

/** The order with one item moved to another position. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
