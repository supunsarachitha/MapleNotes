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

/** Reads a todo list from its Markdown. Lines that are not `- [ ]` items (edited as text, say) become open items. */
export function parseTodo(content: string): TodoList {
  const { title, body } = splitTitle(content);
  const items: TodoItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = ITEM.exec(line);
    if (match) {
      const text = oneLine(match[2]!);
      if (text) items.push({ text, done: match[1] !== " " });
    } else if (line.trim()) {
      items.push({ text: oneLine(line.replace(BULLET, "")), done: false });
    }
  }
  return { title, items };
}

/** Writes a todo list as Markdown; a list always has a title, so it is never empty. */
export function serializeTodo(list: TodoList): string {
  const body = list.items
    .filter((item) => oneLine(item.text))
    .map((item) => `- [${item.done ? "x" : " "}] ${oneLine(item.text)}`)
    .join("\n");
  return joinTitle(oneLine(list.title) || "Untitled list", body);
}
