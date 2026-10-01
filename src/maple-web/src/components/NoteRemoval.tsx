import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { useDeleteNote, useInvalidateNotes, usePatchNote } from "../lib/queries";
import type { Note } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toaster";

/**
 * Deleting a note, todo list or habit. With the trash on (the default) it moves to the trash at once, and the toast
 * offers Undo; with the trash off, a dialog asks first and the note is deleted for good. Render `dialog` somewhere in
 * the card.
 */
export function useRemoveNote(
  note: Note,
  text: {
    /** "note", "list" or "habit". */
    noun: string;
    /** Title of the confirmation when the trash is off, e.g. "Delete this note?". */
    confirmTitle: string;
    /** What the confirmation says is deleted for good. */
    confirmDescription: string;
  },
): { inTrash: boolean; menuLabel: string; start: () => void; dialog: ReactNode } {
  const { trash } = usePreferences();
  const patch = usePatchNote();
  const remove = useDeleteNote();
  const invalidate = useInvalidateNotes();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const noun = text.noun.charAt(0).toUpperCase() + text.noun.slice(1);

  function start() {
    if (!trash) {
      setConfirming(true);
      return;
    }
    patch.mutate(
      { id: note.id, isTrashed: true },
      {
        onSuccess: () =>
          toast.info(`${noun} moved to the trash.`, {
            label: "Undo",
            // The card is gone by now, so this does not depend on it.
            onClick: () =>
              void api
                .patchNote(note.id, { isTrashed: false })
                .then(invalidate)
                .catch(() => toast.error("Could not restore it. Find it in Settings → Backup & data → Trash.")),
          }),
        onError: () => toast.error(`Could not move the ${text.noun} to the trash. Please try again.`),
      },
    );
  }

  const dialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      title={text.confirmTitle}
      description={text.confirmDescription}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() =>
        remove.mutate(note.id, {
          onSuccess: () => {
            setConfirming(false);
            toast.info(`${noun} deleted.`);
          },
          onError: () => toast.error(`Could not delete the ${text.noun}.`),
        })
      }
    />
  );

  return { inTrash: trash, menuLabel: trash ? "Move to trash" : "Delete…", start, dialog };
}
