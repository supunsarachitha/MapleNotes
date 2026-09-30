import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { dateOf, parseHabit, serializeHabit, toggleDay, type Habit } from "../lib/habits";
import { saveErrorMessage } from "../lib/apiError";
import { useNoteEditor } from "../lib/noteEditor";
import { useDeleteNote, usePatchNote } from "../lib/queries";
import type { Note } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { MenuItem } from "./NoteCard";
import { useToast } from "./Toaster";
import { Button, IconButton, cn } from "./ui";

/**
 * The layout of the week's header and of each habit: the name, the days and the menu on one line; on phones the name
 * and the menu share a line and the days go under them.
 */
export const HABIT_ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]";
export const DAY_GRID = "col-span-2 grid grid-cols-7 justify-items-center gap-1 sm:order-2 sm:col-span-1 sm:flex";

const longDate = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export const habitName = (habit: Habit) => habit.name || "Untitled habit";
export const dayCount = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/**
 * A habit on the Habits page: tap a day to mark it done or not done; rename, archive or delete the habit from its
 * menu. Every tick shows at once and is saved in the background as the habit's Markdown (see lib/habits.ts).
 */
export function HabitRow({ note, days, today }: { note: Note; days: string[]; today: string }) {
  const toast = useToast();
  const [habit, commit] = useNoteEditor<Habit>(note, parseHabit, serializeHabit, (error) =>
    toast.error(saveErrorMessage(error, "A change to this habit could not be saved. Please try again.")),
  );
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Renaming starts once the menu has closed: while it is open, it keeps focus inside itself.
  const renameAfterClose = useRef(false);
  const patch = usePatchNote();
  const name = habitName(habit);
  const done = new Set(habit.days);

  function finishRename() {
    setRenaming(false);
    const clean = draft.trim();
    if (clean && clean !== habit.name) commit({ ...habit, name: clean });
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenaming(false);
    }
  }

  return (
    <li className={cn(HABIT_ROW, "py-2.5")}>
      {renaming ? (
        <input
          autoFocus
          aria-label="Habit name"
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={onKey}
          className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-1 text-[15px] font-medium outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950"
        />
      ) : (
        <span className="min-w-0 break-words font-medium">{name}</span>
      )}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton label="Habit actions" className="sm:order-3">
            <MoreHorizontal className="size-5" />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              if (!renameAfterClose.current) return;
              renameAfterClose.current = false;
              event.preventDefault(); // the name field takes focus instead of the menu button
              setDraft(habit.name);
              setRenaming(true);
            }}
            className="z-50 min-w-48 rounded-xl border border-stone-200 bg-white p-1 text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          >
            <MenuItem
              icon={Pencil}
              onSelect={() => {
                renameAfterClose.current = true;
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              icon={Archive}
              onSelect={() =>
                patch.mutate(
                  { id: note.id, isArchived: true },
                  {
                    onSuccess: () => toast.info("Archived. It keeps its history under Archived habits."),
                    onError: () => toast.error("That didn't work. Please try again."),
                  },
                )
              }
            >
              Archive
            </MenuItem>
            <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
            <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(true)}>
              Delete…
            </MenuItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className={DAY_GRID}>
        {days.map((day) => {
          const isDone = done.has(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={isDone}
              aria-label={`${name}, ${day === today ? "today, " : ""}${longDate.format(dateOf(day))}`}
              onClick={() => commit(toggleDay(habit, day))}
              className={cn(
                "flex size-10 items-center justify-center rounded-full border-2 transition-colors sm:size-9",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500",
                isDone
                  ? "border-maple-600 bg-maple-600 text-white hover:bg-maple-700 dark:border-maple-500 dark:bg-maple-500 dark:text-stone-950"
                  : cn(
                      "text-transparent hover:border-maple-400 dark:hover:border-maple-500",
                      day === today ? "border-maple-500 dark:border-maple-400" : "border-stone-300 dark:border-stone-600",
                    ),
              )}
            >
              <Check className="size-5" strokeWidth={3} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <DeleteHabitDialog note={note} habit={habit} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </li>
  );
}

/** An archived habit: out of the list and the chart, with its history kept, until it is restored or deleted. */
export function ArchivedHabitRow({ note }: { note: Note }) {
  const habit = parseHabit(note.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = usePatchNote();
  const toast = useToast();
  const name = habitName(habit);

  return (
    <li className="flex items-center gap-2 py-2">
      <span className="min-w-0 flex-1 break-words">{name}</span>
      <span className="shrink-0 text-sm tabular-nums text-stone-500 dark:text-stone-400">{dayCount(habit.days.length)}</span>
      <Button
        variant="secondary"
        className="h-9"
        onClick={() =>
          patch.mutate(
            { id: note.id, isArchived: false },
            { onSuccess: () => toast.info(`Restored "${name}".`), onError: () => toast.error("That didn't work. Please try again.") },
          )
        }
      >
        <ArchiveRestore className="size-4" aria-hidden="true" /> Restore
      </Button>
      <IconButton label={`Delete ${name}`} onClick={() => setConfirmDelete(true)}>
        <Trash2 className="size-5" />
      </IconButton>
      <DeleteHabitDialog note={note} habit={habit} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </li>
  );
}

function DeleteHabitDialog({
  note,
  habit,
  open,
  onOpenChange,
}: {
  note: Note;
  habit: Habit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteNote();
  const toast = useToast();
  const history = habit.days.length > 0 ? ` and its history (${dayCount(habit.days.length)} done)` : "";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this habit?"
      description={`"${habitName(habit)}"${history} will be deleted permanently.${note.isArchived ? "" : " To keep its history out of sight instead, archive it."}`}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() =>
        remove.mutate(note.id, {
          onSuccess: () => {
            onOpenChange(false);
            toast.info("Habit deleted.");
          },
          onError: () => toast.error("Could not delete the habit."),
        })
      }
    />
  );
}
