import type { SecondFactorRule, UserRole } from "./types";

/**
 * Set on the device that created the first account, so Settings → Administration suggests requiring a second factor
 * for administrators on a new server. Device-only on purpose: it is a hint for the person who just set the server up,
 * not a setting.
 */
const SUGGEST_KEY = "maple.suggestSecondFactor";

/** Whether the server's rule makes an account with this role have two-factor sign-in or a passkey. */
export function ruleCovers(rule: SecondFactorRule | undefined, role: UserRole): boolean {
  return rule === "Everyone" || (rule === "Administrators" && role === "Admin");
}

/** Remembers that this device just set the server up. */
export function suggestSecondFactor(): void {
  try {
    localStorage.setItem(SUGGEST_KEY, "1");
  } catch {
    // Storage can be unavailable (private windows); the suggestion is only a hint.
  }
}

/** Whether to suggest requiring a second factor for administrators. */
export function secondFactorSuggested(): boolean {
  try {
    return localStorage.getItem(SUGGEST_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stops suggesting it, after the administrator chose a rule or said not now. */
export function dismissSecondFactorSuggestion(): void {
  try {
    localStorage.removeItem(SUGGEST_KEY);
  } catch {
    // Nothing to forget.
  }
}
