import { ChevronLeft, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Markdown } from "../components/Markdown";
import { NoteList } from "../components/NoteList";
import { useToast } from "../components/Toaster";
import { Button, EmptyState } from "../components/ui";
import { api } from "../lib/api";
import { formatAbsolute, formatRelative } from "../lib/format";
import { parseHabit } from "../lib/habits";
import { ALL_KINDS } from "../lib/kinds";
import { usePreferences } from "../lib/preferences";
import { useDeleteNote, useInvalidateNotes, useNotes, usePatchNote } from "../lib/queries";
import { Link } from "../lib/router";
import type { Note, NoteKind } from "../lib/types";

/** How long notes stay in the trash; the server deletes them after that (NoteService.TrashRetention). */
export const TRASH_DAYS = 30;

const KIND_NAMES: Record<NoteKind, string> = { Note: "Note", Todo: "Todo list", Quick: "Quick note", Habit: "Habit" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Days left before a note deleted at this time is deleted for good. */
export function daysLeft(trashedAtUtc: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(trashedAtUtc) + TRASH_DAYS * 86_400_000 - now) / 86_400_000));
}

/** A note in the trash: what it was, when it was deleted, and Restore or Delete forever. Its files are not loaded. */
function TrashCard({ note }: { note: Note }) {
  const patch = usePatchNote();
  const remove = useDeleteNote();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const deletedAt = note.trashedAtUtc ?? note.updatedAtUtc;
  const left = daysLeft(deletedAt);
  const habit = note.kind === "Habit" ? parseHabit(note.content) : null;

  return (
    <article className="note-card rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500 dark:text-stone-400">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {KIND_NAMES[note.kind]}
        </span>
        <time dateTime={deletedAt} title={formatAbsolute(deletedAt)}>
          Deleted {formatRelative(deletedAt)}
        </time>
        <span>· {left === 0 ? "deleted for good today" : `deleted for good in ${count(left, "day")}`}</span>
      </header>

      {habit ? (
        <p className="font-medium">
          {habit.name || "Untitled habit"} <span className="font-normal text-stone-500 dark:text-stone-400">· {count(habit.days.length, "day")} done</span>
        </p>
      ) : note.content.trim() ? (
        <div className="relative max-h-48 overflow-hidden">
          <Markdown content={note.content} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white dark:from-stone-900" />
        </div>
      ) : null}
      {note.attachments.length > 0 && (
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">With {count(note.attachments.length, "file")}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="h-9"
          busy={patch.isPending}
          onClick={() =>
            patch.mutate(
              { id: note.id, isTrashed: false },
              {
                onSuccess: () => toast.info(note.isArchived ? "Restored to the archive." : "Restored."),
                onError: () => toast.error("Could not restore it. Please try again."),
              },
            )
          }
        >
          <RotateCcw className="size-4" aria-hidden="true" /> Restore
        </Button>
        <Button variant="ghost" className="h-9 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950" onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" aria-hidden="true" /> Delete forever…
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete forever?"
        description={
          note.attachments.length > 0
            ? `It and its ${count(note.attachments.length, "file")} will be deleted permanently. This cannot be undone.`
            : "It will be deleted permanently. This cannot be undone."
        }
        confirmLabel="Delete forever"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(note.id, {
            onSuccess: () => {
              setConfirming(false);
              toast.info("Deleted for good.");
            },
            onError: () => toast.error("Could not delete it. Please try again."),
          })
        }
      />
    </article>
  );
}

/**
 * The trash, reached from Settings rather than the menu: deleted notes, todo lists, quick notes and habits, most
 * recently deleted first, each to restore or delete for good, and Empty trash for all of them.
 */
export function TrashPage() {
  const { trash } = usePreferences();
  const toast = useToast();
  const invalidate = useInvalidateNotes();
  const [confirming, setConfirming] = useState(false);
  const [emptying, setEmptying] = useState(false);
  // The same list the page shows (same query), to know whether there is anything to empty.
  const list = useNotes("trash", undefined, undefined, ALL_KINDS);
  const hasNotes = (list.data?.pages[0]?.items.length ?? 0) > 0;

  async function empty() {
    setEmptying(true);
    try {
      const deleted = await api.emptyTrash();
      await invalidate();
      setConfirming(false);
      toast.info(deleted.files > 0 ? `Deleted ${count(deleted.notes, "note")} and ${count(deleted.files, "file")} for good.` : `Deleted ${count(deleted.notes, "note")} for good.`);
    } catch {
      toast.error("Could not empty the trash. Please try again.");
    } finally {
      setEmptying(false);
    }
  }

  return (
    <>
      <Link
        href="/settings/data"
        className="-ml-2 mb-2 inline-flex h-9 items-center gap-1 rounded-full px-2 text-sm text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Settings
      </Link>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-xl font-semibold">Trash</h1>
        {hasNotes && (
          <Button variant="danger" className="h-9" onClick={() => setConfirming(true)}>
            Empty trash…
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Deleted notes wait here for {TRASH_DAYS} days, then they are deleted for good. Restore one to put it back where it was. Notes here still count
        towards your storage.
      </p>
      {!trash && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The trash is turned off, so deleting is immediate and permanent. Notes already here stay until they are deleted.{" "}
          <Link href="/settings/features" className="font-medium underline">
            Turn it on in Settings.
          </Link>
        </p>
      )}
      <NoteList
        state="trash"
        kinds={ALL_KINDS}
        renderNote={(note) => <TrashCard note={note} />}
        showEndMarker={false}
        empty={<EmptyState title="The trash is empty">Notes you delete wait here for {TRASH_DAYS} days.</EmptyState>}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Empty the trash?"
        description="Everything in the trash, with its files, is deleted permanently. This cannot be undone."
        confirmLabel="Empty trash"
        busy={emptying}
        onConfirm={() => void empty()}
      />
    </>
  );
}
