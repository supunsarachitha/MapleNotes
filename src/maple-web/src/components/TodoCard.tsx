import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, FileText, GripVertical, ListChecks, MoreHorizontal, Pencil, Pin, PinOff, Tag, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { saveErrorMessage } from "../lib/apiError";
import { focusAtEnd, focusAtEndRef } from "../lib/focus";
import { moveItem } from "../lib/menu";
import { useNoteEditor } from "../lib/noteEditor";
import { usePreferences } from "../lib/preferences";
import { usePatchNote } from "../lib/queries";
import { addItem, parseItems, parseTodo, serializeItems, serializeTodo, type TodoItem, type TodoList, toggleItem } from "../lib/todo";
import type { Note } from "../lib/types";
import { LabelChips, LabelPicker } from "./Labels";
import { MenuItem } from "./NoteCard";
import { useRemoveNote } from "./NoteRemoval";
import { useToast } from "./Toaster";
import { Button, IconButton, cn } from "./ui";

const inputClass =
  "min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-[15px] outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950";

/** All of a list's items as Markdown in one text box, one per line, for changing many of them at once. */
function ItemsEditor({ title, initial, onSave, onCancel }: { title: string; initial: string; onSave: (markdown: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hint = useId();

  // Grow the text box with its content, up to a comfortable maximum.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 480)}px`;
  }, [text]);

  // Carry on at the end of the items, once the box has its full height.
  useEffect(() => focusAtEnd(textarea.current), []);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="mt-2">
      <textarea
        ref={textarea}
        aria-label={`Items in ${title} as Markdown`}
        aria-describedby={hint}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="- [ ] An item"
        className="block w-full resize-none rounded-lg border border-stone-300 bg-white px-2 py-1.5 font-mono text-sm leading-relaxed outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950"
      />
      <p id={hint} className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        One item per line: <code>- [ ]</code> to do, <code>- [x]</code> done. Other lines become items to do.
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-stone-400 sm:inline">Ctrl/⌘ + Enter to save</span>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(text)}>Save</Button>
      </div>
    </div>
  );
}

/**
 * A todo list in the Todo tab: tick, add, edit and remove items, or edit them all at once as Markdown; rename, label,
 * pin, archive or delete the list. Every change shows at once and is saved in the background, one save after another,
 * as the list's Markdown (see lib/todo.ts and lib/noteEditor.ts).
 */
export function TodoCard({ note, autoFocus = false }: { note: Note; autoFocus?: boolean }) {
  const toast = useToast();
  const { archive, labels } = usePreferences();
  const [list, commit] = useNoteEditor<TodoList>(note, parseTodo, serializeTodo, (error) =>
    toast.error(saveErrorMessage(error, "A change to this list could not be saved. Please try again.")),
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [newItem, setNewItem] = useState("");
  const [choosingLabels, setChoosingLabels] = useState(false);
  // The items as Markdown while they are being edited all at once.
  const [markdown, setMarkdown] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  // Renaming and editing as Markdown start once the menu has closed: while it is open, it keeps focus inside itself.
  const afterClose = useRef<(() => void) | null>(null);
  const patch = usePatchNote();
  const removal = useRemoveNote(note, {
    noun: "list",
    confirmTitle: "Delete this list?",
    confirmDescription: `"${list.title}" and its ${list.items.length} item(s) will be deleted permanently. To keep it out of sight instead, archive it.`,
  });

  useEffect(() => {
    if (autoFocus) addInput.current?.focus();
  }, [autoFocus]);

  // Reordering: while an item is dragged by its handle, the order as it is on screen; saved when it is let go. The
  // handle is also a button that the arrow keys move, which keyboards and screen readers use.
  const [order, setOrder] = useState<TodoItem[] | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const handles = useRef<Array<HTMLButtonElement | null>>([]);
  const shown = order ?? list.items;

  function saveOrder(items: TodoItem[], item: TodoItem) {
    if (serializeItems(items) === serializeItems(list.items)) return;
    commit({ ...list, items });
    setAnnouncement(`${item.text} moved to position ${items.indexOf(item) + 1} of ${items.length}.`);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(index);
    setOrder(list.items);
  }

  function drag(event: PointerEvent<HTMLButtonElement>) {
    if (held === null || !order) return;
    for (let to = 0; to < order.length; to++) {
      const row = rows.current[to];
      if (to === held || !row) continue;
      const box = row.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      // Past the middle of the row in the direction of travel: the rows swap, without flickering back and forth.
      const middle = box.top + box.height / 2;
      if ((to > held && event.clientY > middle) || (to < held && event.clientY < middle)) {
        setOrder(moveItem(order, held, to));
        setHeld(to);
      }
      break;
    }
  }

  function endDrag() {
    if (held !== null && order) saveOrder(order, order[held]!);
    setHeld(null);
    setOrder(null);
  }

  function moveByKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? list.items.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= list.items.length || to === index) return;
    saveOrder(moveItem(list.items, index, to), list.items[index]!);
    requestAnimationFrame(() => handles.current[to]?.focus()); // the handle keeps focus as its item moves
  }

  const done = list.items.filter((item) => item.done).length;

  // Ticked items move to the bottom and unticked ones back above them; the box keeps focus as its item moves, and the
  // move is announced, so a keyboard user does not tick the next item by mistake.
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  function toggle(index: number) {
    const item = list.items[index]!;
    const items = toggleItem(list.items, index);
    const to = items.findIndex((other) => !list.items.includes(other)); // the ticked item is the only new object
    commit({ ...list, items });
    if (to === index) return;
    setAnnouncement(`${item.text} ${item.done ? "moved above the ticked items" : "moved to the bottom"}.`);
    requestAnimationFrame(() => boxes.current[to]?.focus());
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    commit({ ...list, items: addItem(list.items, text) });
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

  function saveMarkdown(text: string) {
    setMarkdown(null);
    const items = parseItems(text);
    if (serializeItems(items) !== serializeItems(list.items)) commit({ ...list, items });
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
      className="note-card rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <header className="-mt-1 flex items-center gap-2">
        {renaming ? (
          <input
            ref={focusAtEndRef}
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
                const start = afterClose.current;
                if (!start) return;
                afterClose.current = null;
                event.preventDefault(); // the field takes focus instead of the menu button
                start();
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
                      afterClose.current = () => {
                        setDraft(list.title);
                        setRenaming(true);
                      };
                    }}
                  >
                    Rename
                  </MenuItem>
                  {labels && (
                    <MenuItem icon={Tag} onSelect={() => setChoosingLabels(true)}>
                      Labels…
                    </MenuItem>
                  )}
                  {markdown === null && (
                    <MenuItem
                      icon={FileText}
                      onSelect={() => {
                        afterClose.current = () => {
                          setEditing(null);
                          setMarkdown(serializeItems(list.items));
                        };
                      }}
                    >
                      Edit as Markdown
                    </MenuItem>
                  )}
                  {done > 0 && (
                    <MenuItem icon={ListChecks} onSelect={() => commit({ ...list, items: list.items.filter((item) => !item.done) })}>
                      Clear completed
                    </MenuItem>
                  )}
                </>
              )}
              {(archive || note.isArchived) && (
                <MenuItem
                  icon={note.isArchived ? ArchiveRestore : Archive}
                  onSelect={() => change({ isArchived: !note.isArchived }, note.isArchived ? "Restored." : "Archived.")}
                >
                  {note.isArchived ? "Restore" : "Archive"}
                </MenuItem>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
              <MenuItem icon={Trash2} danger onSelect={removal.start}>
                {removal.menuLabel}
              </MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      {markdown !== null && !note.isArchived ? (
        <ItemsEditor title={list.title} initial={markdown} onSave={saveMarkdown} onCancel={() => setMarkdown(null)} />
      ) : (
        <>
          {list.items.length > 0 && (
            <ul className="mt-2 flex flex-col" aria-label={`Items in ${list.title}`}>
              {shown.map((item, index) => (
                <li
                  key={index}
                  ref={(row) => {
                    rows.current[index] = row;
                  }}
                  className={cn(
                    "flex min-h-10 items-center gap-3",
                    held === index && "relative z-10 rounded-lg bg-white shadow-lg ring-2 ring-maple-500 dark:bg-stone-900",
                  )}
                >
                  {!note.isArchived && shown.length > 1 && editing === null && (
                    <button
                      type="button"
                      ref={(handle) => {
                        handles.current[index] = handle;
                      }}
                      aria-label={`Move ${item.text}`}
                      aria-description="Use the up and down arrow keys, or drag."
                      title="Drag to move"
                      onPointerDown={(event) => startDrag(event, index)}
                      onPointerMove={drag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => moveByKey(event, index)}
                      className="-ml-2 -mr-2 flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-300 outline-none hover:bg-stone-100 hover:text-stone-500 focus-visible:ring-2 focus-visible:ring-maple-500 active:cursor-grabbing dark:text-stone-600 dark:hover:bg-stone-800"
                    >
                      <GripVertical className="size-4" aria-hidden="true" />
                    </button>
                  )}
                  <input
                    type="checkbox"
                    ref={(box) => {
                      boxes.current[index] = box;
                    }}
                    checked={item.done}
                    onChange={() => toggle(index)}
                    disabled={note.isArchived}
                    aria-label={item.text}
                    className="size-5 shrink-0 cursor-pointer accent-maple-600"
                  />
                  {editing === index ? (
                    <input
                      ref={focusAtEndRef}
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
                        "min-w-0 flex-1 break-words py-1 text-left text-(length:--note-text)",
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
        </>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <LabelChips ids={note.labelIds} />
      {removal.dialog}
      {labels && <LabelPicker note={note} open={choosingLabels} onOpenChange={setChoosingLabels} />}
    </article>
  );
}
