import { usePreferences } from "./preferences";
import type { NoteKind, Preferences } from "./types";

/** Every kind of note: exports cover them all. */
export const ALL_KINDS: NoteKind[] = ["Note", "Todo", "Quick", "Habit"];

/**
 * The kinds of notes the user has turned on: searches, tag views and the archive cover these. Habits never appear
 * among notes; the Habits page lists them.
 */
export function enabledKinds(preferences: Preferences): NoteKind[] {
  const kinds: NoteKind[] = ["Note"];
  if (preferences.todoLists) kinds.push("Todo");
  if (preferences.quickNotes) kinds.push("Quick");
  return kinds;
}

export function useEnabledKinds(): NoteKind[] {
  return enabledKinds(usePreferences());
}
