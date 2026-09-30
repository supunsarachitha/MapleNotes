import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "./api";
import { queryKeys, useAuthStatus } from "./queries";
import type { AuthStatus, Preferences } from "./types";

/** What a new account starts with; the server applies the same defaults. */
export const DEFAULT_PREFERENCES: Preferences = {
  noteTitles: false,
  dateInTitles: false,
  dateFormat: "yyyy-MM-dd",
  todoLists: true,
  quickNotes: true,
  dailyNotes: false,
  calendar: true,
  habitTracker: false,
  linkPreviews: false,
  theme: "System",
  accent: "Maple",
};

/** The signed-in user's preferences (from the sign-in status, so every device sees the same). */
export function usePreferences(): Preferences {
  return useAuthStatus().data?.user?.preferences ?? DEFAULT_PREFERENCES;
}

/**
 * Changes one or more preferences. The change shows at once (the cached user is updated before the server answers)
 * and is rolled back if saving fails. Changes are sent one after another, each with every change made so far.
 */
export function useUpdatePreferences() {
  const client = useQueryClient();
  const latest = useRef(0);

  const read = () => client.getQueryData<AuthStatus>(queryKeys.status)?.user?.preferences ?? DEFAULT_PREFERENCES;
  const write = (preferences: Preferences) =>
    client.setQueryData<AuthStatus>(queryKeys.status, (status) =>
      status?.user ? { ...status, user: { ...status.user, preferences } } : status,
    );

  return useMutation({
    scope: { id: "preferences" },
    onMutate: (changes: Partial<Preferences>) => {
      const previous = read();
      write({ ...previous, ...changes });
      return { previous, id: ++latest.current };
    },
    mutationFn: () => api.setPreferences(read()),
    onError: (_error, _changes, context) => {
      if (context && context.id === latest.current) write(context.previous);
    },
    onSuccess: (saved, _changes, context) => {
      if (context.id === latest.current) write(saved);
    },
  });
}
