import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useInvalidateNotes } from "./queries";
import type { Note } from "./types";

/**
 * Edits a note whose text has a structure, such as a todo list or a habit. The value shows every change at once, and
 * each change is saved in the background as the note's text, one save after another; `onError` runs when a save
 * fails. The server's version replaces the value when it changes (another device, or a failed save), unless one of our
 * own saves is still on its way or the version is older than our last save. `parse` and `serialize` must not change
 * between renders (module-level functions).
 */
export function useNoteEditor<T>(
  note: Note,
  parse: (content: string) => T,
  serialize: (value: T) => string,
  onError: (error: unknown) => void,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => parse(note.content));
  const saving = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  // The version of our own last save. A refresh that left the server before it can arrive after it; its older text
  // must not replace ours.
  const lastSaved = useRef({ at: Date.parse(note.updatedAtUtc), content: note.content });
  const invalidate = useInvalidateNotes();

  useEffect(() => {
    if (pending.current > 0) return;
    const at = Date.parse(note.updatedAtUtc);
    if (at < lastSaved.current.at || (at === lastSaved.current.at && note.content !== lastSaved.current.content)) return;
    setValue(parse(note.content));
  }, [note.content, note.updatedAtUtc]);

  function commit(next: T) {
    setValue(next);
    pending.current++;
    const content = serialize(next);
    const attachmentIds = note.attachments.map((attachment) => attachment.id);
    saving.current = saving.current
      .then(() => api.updateNote(note.id, content, attachmentIds, note))
      .then(
        (saved) => {
          lastSaved.current = { at: Date.parse(saved.updatedAtUtc), content: saved.content };
        },
        (error: unknown) => onError(error),
      )
      .finally(() => {
        pending.current--;
        if (pending.current === 0) void invalidate();
      });
  }

  return [value, commit];
}
