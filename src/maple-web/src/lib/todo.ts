import { joinTitle, splitTitle } from "./titles";

export interface TodoItem {
  text: string;
  done: boolean;
}

/** A todo list as the Todo tab edits it. It is stored as Markdown: a `# title`, then one `- [ ]` line per item. */
export interface TodoList {
  title: string;
  items: TodoItem[];
}

const ITEM = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+/;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Reads items from Markdown, one per line. Lines that are not `- [ ]` items (edited as text, say) become open items. */
export function parseItems(markdown: string): TodoItem[] {
  const items: TodoItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = ITEM.exec(line);
    if (match) {
      const text = oneLine(match[2]!);
      if (text) items.push({ text, done: match[1] !== " " });
    } else if (line.trim()) {
      items.push({ text: oneLine(line.replace(BULLET, "")), done: false });
    }
  }
  return items;
}

/** Writes items as Markdown, one `- [ ]` or `- [x]` line each; empty items are left out. */
export function serializeItems(items: TodoItem[]): string {
  return items
    .filter((item) => oneLine(item.text))
    .map((item) => `- [${item.done ? "x" : " "}] ${oneLine(item.text)}`)
    .join("\n");
}

/** Where a new open item goes: after the last open item, so ticked items stay at the bottom. */
function openEnd(items: TodoItem[]): number {
  let end = items.length;
  while (end > 0 && items[end - 1]!.done) end--;
  return end;
}

/** Adds an open item after the other open items, above the ticked ones. */
export function addItem(items: TodoItem[], text: string): TodoItem[] {
  const at = openEnd(items);
  return [...items.slice(0, at), { text, done: false }, ...items.slice(at)];
}

/**
 * Ticks or unticks an item. A ticked item moves to the bottom of the list; an unticked one goes back to the end of the
 * open items, just above the ticked ones.
 */
export function toggleItem(items: TodoItem[], index: number): TodoItem[] {
  const item = items[index];
  if (!item) return items;
  const toggled = { ...item, done: !item.done };
  const rest = items.filter((_, i) => i !== index);
  if (toggled.done) return [...rest, toggled];
  const at = openEnd(rest);
  return [...rest.slice(0, at), toggled, ...rest.slice(at)];
}

/** Reads a todo list from its Markdown: the title, then the items (see parseItems). */
export function parseTodo(content: string): TodoList {
  const { title, body } = splitTitle(content);
  return { title, items: parseItems(body) };
}

/** Writes a todo list as Markdown; a list always has a title, so it is never empty. */
export function serializeTodo(list: TodoList): string {
  return joinTitle(oneLine(list.title) || "Untitled list", serializeItems(list.items));
}
