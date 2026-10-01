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

/** Reads a todo list from its Markdown: the title, then the items (see parseItems). */
export function parseTodo(content: string): TodoList {
  const { title, body } = splitTitle(content);
  return { title, items: parseItems(body) };
}

/** Writes a todo list as Markdown; a list always has a title, so it is never empty. */
export function serializeTodo(list: TodoList): string {
  return joinTitle(oneLine(list.title) || "Untitled list", serializeItems(list.items));
}
