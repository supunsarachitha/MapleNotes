import { useEffect } from "react";
import type { Accent, Theme } from "./types";

// Applies the user's theme (light, dark or the device's) and accent colour to the page. The choice is also remembered
// on this device, so the next visit (including the sign-in screen) starts with it before anything is shown.

const STORAGE_KEY = "maple-notes:appearance";

/** Each accent's main shade (600), for swatches and the browser's theme colour. Must match index.css. */
export const ACCENT_COLORS: Record<Accent, string> = {
  Maple: "#8f1d21",
  Ocean: "#1d4ed8",
  Forest: "#166534",
  Teal: "#115e59",
  Plum: "#6b21a8",
  Amber: "#9a3412",
  Slate: "#334155",
};

/** Sets the page's theme and accent now. System leaves light or dark to the device (see index.css). */
export function applyAppearance(theme: Theme, accent: Accent): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "Dark");
  root.classList.toggle("light", theme === "Light");
  root.style.colorScheme = theme === "System" ? "" : theme.toLowerCase();
  if (accent === "Maple") delete root.dataset.accent;
  else root.dataset.accent = accent.toLowerCase();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ACCENT_COLORS[accent] ?? ACCENT_COLORS.Maple);
}

/** Applies the appearance remembered on this device (or the defaults); called before the app first renders. */
export function applySavedAppearance(): void {
  let saved: { theme?: Theme; accent?: Accent } = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as typeof saved;
  } catch {
    // no storage (private mode, blocked): the defaults
  }
  applyAppearance(saved.theme ?? "System", saved.accent && saved.accent in ACCENT_COLORS ? saved.accent : "Maple");
}

/** Keeps the page in the signed-in user's appearance, and remembers it on this device for the next visit. */
export function useAppearance(theme: Theme | undefined, accent: Accent | undefined): void {
  useEffect(() => {
    if (!theme || !accent) return;
    applyAppearance(theme, accent);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, accent }));
    } catch {
      // the choice still applies now; it is just not remembered on this device
    }
  }, [theme, accent]);
}
