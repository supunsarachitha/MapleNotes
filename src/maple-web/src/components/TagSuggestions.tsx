import { Hash } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { caretPosition } from "../lib/caret";
import { useEnabledKinds } from "../lib/kinds";
import { useTags } from "../lib/queries";
import { insertTag, suggestTags, tagQueryAt, type TagQuery } from "../lib/tagSuggest";
import type { Tag } from "../lib/types";
import { cn } from "./ui";

const POPUP_WIDTH = 256;

interface Open {
  query: TagQuery;
  caret: number;
  items: Tag[];
  active: number;
  position: { top: number; left: number };
}

/**
 * Suggests the account's existing tags while a #tag is typed in a text box, in a list next to the caret: arrows move
 * through it, Enter or Tab puts the chosen tag in, Esc closes it. The text box keeps focus throughout, so typing just
 * carries on. Spread `inputProps` on the text box and call `onKeyDown` first in its own key handler (it returns true
 * when it handled the key); render `popup` inside a `relative` box around the text box.
 */
export function useTagSuggestions(
  textarea: RefObject<HTMLTextAreaElement | null>,
  setText: (text: string) => void,
  enabled: boolean,
): {
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  update: () => void;
  close: () => void;
  inputProps: Record<string, string | undefined>;
  popup: ReactNode;
} {
  const tags = useTags(useEnabledKinds(), enabled);
  const [open, setOpen] = useState<Open | null>(null);
  // Esc keeps the list closed for the tag it was pressed on, until the caret leaves it.
  const dismissed = useRef<number | null>(null);
  const caretAfterInsert = useRef<number | null>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  // After a tag is put in, the caret goes after it (once the new text is in the box).
  useLayoutEffect(() => {
    const element = textarea.current;
    if (caretAfterInsert.current === null || !element) return;
    element.setSelectionRange(caretAfterInsert.current, caretAfterInsert.current);
    caretAfterInsert.current = null;
  });

  function update() {
    const element = textarea.current;
    if (!enabled || !element || !tags.data || element.selectionStart !== element.selectionEnd) {
      setOpen(null);
      return;
    }
    const caret = element.selectionStart;
    const query = tagQueryAt(element.value, caret);
    if (!query || query.start === dismissed.current) {
      if (!query) dismissed.current = null;
      setOpen(null);
      return;
    }
    const items = suggestTags(tags.data, query.text);
    if (items.length === 0) {
      setOpen(null);
      return;
    }
    const at = caretPosition(element, query.start);
    const width = element.clientWidth;
    setOpen((current) => ({
      query,
      caret,
      items,
      // Keep the highlighted tag while it still matches.
      active: current ? Math.max(0, items.findIndex((item) => item.name === current.items[current.active]?.name)) : 0,
      position: { top: element.offsetTop + at.top + at.height, left: Math.max(0, Math.min(at.left, width - POPUP_WIDTH)) },
    }));
  }

  function choose(tag: Tag) {
    const element = textarea.current;
    if (!open || !element) return;
    const next = insertTag(element.value, open.query, open.caret, tag.name);
    caretAfterInsert.current = next.caret;
    setText(next.text);
    setOpen(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    const move = (by: number) => setOpen({ ...open, active: (open.active + by + open.items.length) % open.items.length });
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) || event.key === "Tab") {
      choose(open.items[open.active]!);
    } else if (event.key === "Escape") {
      dismissed.current = open.query.start;
      setOpen(null);
    } else return false;
    event.preventDefault();
    return true;
  }

  const popup = (
    <>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          style={{ top: open.position.top, left: open.position.left, width: POPUP_WIDTH }}
          className="absolute z-20 max-w-full overflow-hidden rounded-xl border border-stone-200 bg-white p-1 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {open.items.map((tag, index) => (
            <li
              key={tag.name}
              id={optionId(index)}
              role="option"
              aria-selected={index === open.active}
              // Choosing with the mouse must not take focus from the text box.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(tag)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2",
                index === open.active ? "bg-maple-50 text-maple-700 dark:bg-maple-600/15 dark:text-maple-400" : "hover:bg-stone-100 dark:hover:bg-stone-800",
              )}
            >
              <Hash className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">{tag.noteCount}</span>
            </li>
          ))}
        </ul>
      )}
      {enabled && (
        <span className="sr-only" aria-live="polite">
          {open ? `${open.items.length === 1 ? "1 tag suggestion" : `${open.items.length} tag suggestions`}. Arrows to choose, Enter to insert.` : ""}
        </span>
      )}
    </>
  );

  return {
    onKeyDown,
    update,
    close: () => setOpen(null),
    inputProps: {
      "aria-autocomplete": enabled ? "list" : undefined,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? optionId(open.active) : undefined,
    },
    popup,
  };
}
