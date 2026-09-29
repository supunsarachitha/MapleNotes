import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, ListChecks, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../lib/api";
import { useDeleteNote, useInvalidateNotes, usePatchNote } from "../lib/queries";
import { parseTodo, serializeTodo, type TodoList } from "../lib/todo";
import type { Note } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { MenuItem } from "./NoteCard";
import { useToast } from "./Toaster";
import { IconButton, cn } from "./ui";

const inputClass =
  "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-[15px] outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950";

/**
 * A todo list in the Todo tab: tick, add, edit and remove items, rename, pin, archive or delete the list. Every change
 * shows at once and is saved in the background, one save after another, as the list's Markdown (see lib/todo.ts).
 */
export function TodoCard({ note, autoFocus = false }: { note: Note; autoFocus?: boolean }) {
  const [list, setList] = useState<TodoList>(() => parseTodo(note.content));
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [newItem, setNewItem] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const addInput = useRef<HTMLInputElement>(null);
  // Renaming starts once the menu has closed: while it is open, it keeps focus inside itself.
  const renameAfterClose = useRef(false);
  const invalidate = useInvalidateNotes();
  const patch = usePatchNote();
  const remove = useDeleteNote();
  const toast = useToast();

  // Take the server's version when it changes, unless one of our own saves is still on its way.
  useEffect(() => {
    if (pending.current === 0) setList(parseTodo(note.content));
  }, [note.content]);

  useEffect(() => {
    if (autoFocus) addInput.current?.focus();
  }, [autoFocus]);

  function commit(next: TodoList) {
    setList(next);
    pending.current++;
    const content = serializeTodo(next);
    const attachmentIds = note.attachments.map((a) => a.id);
    saving.current = saving.current
      .then(() => api.updateNote(note.id, content, attachmentIds))
      .then(
        () => undefined,
        () => toast.error("A change to this list could not be saved. Please try again."),
      )
      .finally(() => {
        pending.current--;
        if (pending.current === 0) void invalidate();
      });
  }

  const done = list.items.filter((item) => item.done).length;

  function toggle(index: number) {
    commit({ ...list, items: list.items.map((item, i) => (i === index ? { ...item, done: !item.done } : item)) });
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    commit({ ...list, items: [...list.items, { text, done: false }] });
  }

  function startEdit(index: number) {
    setEditing(index);
    setDraft(list.items[index]!.text);
  }

  function finishEdit() {
    if (editing === null) return;
    const text = draft.trim();
    const index = editing;
    setEditing(null);
    if (!text) commit({ ...list, items: list.items.filter((_, i) => i !== index) });
    else if (text !== list.items[index]!.text) {
      commit({ ...list, items: list.items.map((item, i) => (i === index ? { ...item, text } : item)) });
    }
  }

  function finishRename() {
    setRenaming(false);
    const title = draft.trim();
    if (title && title !== list.title) commit({ ...list, title });
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>, finish: () => void) {
    if (event.key === "Enter") {
      event.preventDefault();
      finish();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
      setRenaming(false);
    }
  }

  function change(changes: { isPinned?: boolean; isArchived?: boolean }, message: string) {
    patch.mutate({ id: note.id, ...changes }, {
      onSuccess: () => toast.info(message),
      onError: () => toast.error("That didn't work. Please try again."),
    });
  }

  return (
    <article
      aria-label={list.title}
      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <header className="-mt-1 flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            aria-label="List name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => onKey(event, finishRename)}
            className={cn(inputClass, "text-lg font-semibold")}
          />
        ) : (
          <h3 className="min-w-0 flex-1 break-words text-lg font-semibold leading-snug">{list.title}</h3>
        )}
        {note.isPinned && !note.isArchived && <Pin className="size-4 shrink-0 text-maple-600 dark:text-maple-400" aria-label="Pinned" />}
        <span className="shrink-0 text-sm tabular-nums text-stone-500 dark:text-stone-400" aria-label={`${done} of ${list.items.length} done`}>
          {done}/{list.items.length}
        </span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="List actions" className="-mr-2">
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
                setDraft(list.title);
                setRenaming(true);
              }}
              className="z-50 min-w-48 rounded-xl border border-stone-200 bg-white p-1 text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              {!note.isArchived && (
                <>
                  <MenuItem icon={note.isPinned ? PinOff : Pin} onSelect={() => change({ isPinned: !note.isPinned }, note.isPinned ? "Unpinned." : "Pinned to the top.")}>
                    {note.isPinned ? "Unpin" : "Pin to top"}
                  </MenuItem>
                  <MenuItem
                    icon={Pencil}
                    onSelect={() => {
                      renameAfterClose.current = true;
                    }}
                  >
                    Rename
                  </MenuItem>
                  {done > 0 && (
                    <MenuItem icon={ListChecks} onSelect={() => commit({ ...list, items: list.items.filter((item) => !item.done) })}>
                      Clear completed
                    </MenuItem>
                  )}
                </>
              )}
              <MenuItem
                icon={note.isArchived ? ArchiveRestore : Archive}
                onSelect={() => change({ isArchived: !note.isArchived }, note.isArchived ? "Restored." : "Archived.")}
              >
                {note.isArchived ? "Restore" : "Archive"}
              </MenuItem>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
              <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(true)}>
                Delete…
              </MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      {list.items.length > 0 && (
        <ul className="mt-2 flex flex-col" aria-label={`Items in ${list.title}`}>
          {list.items.map((item, index) => (
            <li key={index} className="flex min-h-10 items-center gap-3">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => toggle(index)}
                disabled={note.isArchived}
                aria-label={item.text}
                className="size-5 shrink-0 cursor-pointer accent-maple-600"
              />
              {editing === index ? (
                <input
                  autoFocus
                  aria-label="Edit item"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={finishEdit}
                  onKeyDown={(event) => onKey(event, finishEdit)}
                  className={inputClass}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(index)}
                  disabled={note.isArchived}
                  title="Edit"
                  className={cn(
                    "min-w-0 flex-1 break-words py-1 text-left text-[15px]",
                    item.done && "text-stone-400 line-through dark:text-stone-500",
                  )}
                >
                  {item.text}
                </button>
              )}
              {!note.isArchived && (
                <IconButton label={`Remove ${item.text}`} onClick={() => commit({ ...list, items: list.items.filter((_, i) => i !== index) })} className="size-8 text-stone-400">
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {!note.isArchived && (
        <form onSubmit={add} className="mt-2 flex items-center gap-2">
          <input
            ref={addInput}
            value={newItem}
            onChange={(event) => setNewItem(event.target.value)}
            placeholder="Add an item"
            aria-label={`Add an item to ${list.title}`}
            maxLength={500}
            className="h-10 min-w-0 flex-1 rounded-xl border border-dashed border-stone-300 bg-transparent px-3 text-[15px] outline-none focus:border-solid focus:border-maple-500 dark:border-stone-700"
          />
        </form>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this list?"
        description={`"${list.title}" and its ${list.items.length} item(s) will be deleted permanently. To keep it out of sight instead, archive it.`}
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(note.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.info("List deleted.");
            },
            onError: () => toast.error("Could not delete the list."),
          })
        }
      />
    </article>
  );
}
