import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { e2ee } from "./e2ee";
import { dayRange } from "./dates";
import type { AuthStatus, NoteKind, NoteState } from "./types";

export const queryKeys = {
  status: ["auth", "status"] as const,
  notes: ["notes"] as const,
  noteList: (state: NoteState, tag?: string, q?: string, kinds: NoteKind[] = ["Note"], day?: string) =>
    ["notes", state, tag ?? "", q ?? "", kinds.join(","), day ?? ""] as const,
  calendar: (month: string, kinds: NoteKind[]) => ["notes", "calendar", month, kinds.join(",")] as const,
  tags: ["tags"] as const,
  tagList: (kinds: NoteKind[]) => ["tags", kinds.join(",")] as const,
  adminSettings: ["admin", "settings"] as const,
  adminUsers: ["admin", "users"] as const,
  encryption: ["account", "encryption"] as const,
};

export const PAGE_SIZE = 20;

export function useAuthStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: api.status, staleTime: 5 * 60_000 });
}

/**
 * After signing out: switch to the sign-in screen immediately, forget every cached note and the end-to-end key of the
 * previous user, then confirm the state with the server.
 */
export function useSignedOut() {
  const client = useQueryClient();
  return () => {
    void e2ee.forget();
    client.setQueryData<AuthStatus>(queryKeys.status, (status) => (status ? { ...status, user: null } : status));
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    void client.invalidateQueries({ queryKey: queryKeys.status });
  };
}

/** One infinitely scrolling list of notes of the given kinds, optionally of one local day (cursor pagination). */
export function useNotes(state: NoteState, tag?: string, q?: string, kinds: NoteKind[] = ["Note"], day?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.noteList(state, tag, q, kinds, day),
    queryFn: ({ pageParam }) =>
      api.listNotes({ state, tag, q, kinds, cursor: pageParam, limit: PAGE_SIZE, ...(day ? dayRange(day) : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Tags with how many active notes of these kinds use them. */
export function useTags(kinds: NoteKind[]) {
  return useQuery({ queryKey: queryKeys.tagList(kinds), queryFn: () => api.listTags(kinds), staleTime: 30_000 });
}

/** Refreshes every note list and the tag list after a change. */
export function useInvalidateNotes() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.notes }),
      client.invalidateQueries({ queryKey: queryKeys.tags }),
    ]);
}

export function usePatchNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, ...changes }: { id: string; isPinned?: boolean; isArchived?: boolean; kind?: NoteKind }) =>
      api.patchNote(id, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({ mutationFn: api.deleteNote, onSuccess: invalidate });
}
