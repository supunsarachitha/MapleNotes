import { usePreferences } from "./preferences";
import type { NoteKind, Preferences } from "./types";

/** The kinds of notes the user has turned on: searches, tag views and the archive cover these. */
export function enabledKinds(preferences: Preferences): NoteKind[] {
  const kinds: NoteKind[] = ["Note"];
  if (preferences.todoLists) kinds.push("Todo");
  if (preferences.quickNotes) kinds.push("Quick");
  return kinds;
}

export function useEnabledKinds(): NoteKind[] {
  return enabledKinds(usePreferences());
}
