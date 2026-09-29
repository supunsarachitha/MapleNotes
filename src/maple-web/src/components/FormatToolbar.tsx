import { Bold, Code, Heading2, Italic, Link2, List, ListChecks, Quote, type LucideIcon } from "lucide-react";
import type { RefObject } from "react";
import { applyEdit, formatEdit, type Format } from "../lib/markdownEdit";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

const TOOLS: Array<{ format: Format; label: string; icon: LucideIcon; key?: string }> = [
  { format: "bold", label: "Bold", icon: Bold, key: "b" },
  { format: "italic", label: "Italic", icon: Italic, key: "i" },
  { format: "heading", label: "Heading", icon: Heading2 },
  { format: "bullets", label: "Bulleted list", icon: List },
  { format: "checklist", label: "Checklist", icon: ListChecks },
  { format: "quote", label: "Quote", icon: Quote },
  { format: "code", label: "Code", icon: Code },
  { format: "link", label: "Link", icon: Link2, key: "k" },
];

/**
 * Formats the selection of a text box as Markdown. The change is typed in by the browser (execCommand insertText),
 * so Undo works as for typing; where that is unavailable the text is set directly.
 */
export function applyFormat(textarea: HTMLTextAreaElement, format: Format, setText: (text: string) => void): void {
  const original = textarea.value;
  const edit = formatEdit(format, original, textarea.selectionStart, textarea.selectionEnd);
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  const typed = typeof document.execCommand === "function" && document.execCommand("insertText", false, edit.insert);
  if (!typed) {
    setText(applyEdit(original, edit));
    requestAnimationFrame(() => textarea.setSelectionRange(edit.selectStart, edit.selectEnd));
    return;
  }
  textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
}

/** The shortcut's format for a key press (Ctrl/⌘ + B, I or K), if any. */
export function shortcutFormat(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): Format | null {
  if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return null;
  return TOOLS.find((tool) => tool.key === event.key.toLowerCase())?.format ?? null;
}

/** Formatting buttons for a Markdown text box. */
export function FormatToolbar({ target, onChange }: { target: RefObject<HTMLTextAreaElement | null>; onChange: (text: string) => void }) {
  return (
    <div role="toolbar" aria-label="Formatting" className="-mx-1 flex gap-0.5 overflow-x-auto">
      {TOOLS.map(({ format, label, icon: Icon, key }) => {
        const title = key ? `${label} (${MOD}${key.toUpperCase()})` : label;
        return (
          <button
            key={format}
            type="button"
            aria-label={label}
            title={title}
            // Keep the text box's selection: the button must not take focus when pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => target.current && applyFormat(target.current, format, onChange)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-maple-500 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
