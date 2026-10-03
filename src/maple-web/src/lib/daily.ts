import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { formatDate, localDateKey } from "./dates";
import { usePreferences } from "./preferences";
import { joinTitle, splitTitle } from "./titles";
import type { Note } from "./types";

/** Today's date on this device, updated when the day changes while the app is open. */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      const next = new Date();
      setNow((current) => (localDateKey(current) === localDateKey(next) ? current : next));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Today's daily note (null until it is started), with the day's key and title, when daily notes are on. */
export function useTodaysNote() {
  const { dailyNotes, dateFormat } = usePreferences();
  const today = useToday();
  const date = localDateKey(today);
  const query = useQuery({
    queryKey: ["notes", "daily", date],
    queryFn: () => api.dailyNote(date),
    enabled: dailyNotes,
  });
  return { enabled: dailyNotes, date, title: formatDate(today, dateFormat), query };
}

/** The text a template note gives a new daily note: everything but its title, since the daily note has the date. */
export const templateText = (content: string) => splitTitle(content).body;

/**
 * The daily-note template, when one is chosen: an ordinary note, whose text starts each new daily note. A template
 * that was deleted, or is in the trash, counts as none; so does one that cannot be loaded (offline, for example).
 */
export function useDailyTemplate() {
  const { dailyNotes, dailyNoteTemplate: id } = usePreferences();
  const enabled = dailyNotes && id !== "";
  // Under "notes", so editing the template refreshes it like any other note.
  const query = useQuery({ queryKey: ["notes", "template", id], queryFn: () => api.note(id), enabled, retry: false });
  const note = enabled && query.data && !query.data.trashedAtUtc ? query.data : null;
  return { id, note, text: note ? templateText(note.content) : "", pending: enabled && query.isPending, failed: enabled && query.isError };
}

/**
 * Saves the first words of a day's note, titled with the date. If another device started the day's note in the
 * meantime, the words are added to that note instead.
 */
export async function saveDailyNote(date: string, title: string, body: string, attachmentIds: string[]): Promise<Note> {
  try {
    return await api.createNote(joinTitle(title, body), attachmentIds, { dailyDate: date });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const existing = await api.dailyNote(date);
    if (!existing) throw error;
    const ids = [...existing.attachments.map((attachment) => attachment.id), ...attachmentIds];
    return api.updateNote(existing.id, body.trim() ? `${existing.content.trimEnd()}\n\n${body}` : existing.content, ids, existing);
  }
}
