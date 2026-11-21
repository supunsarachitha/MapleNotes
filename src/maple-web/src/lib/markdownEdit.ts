// Markdown formatting for the editor's toolbar: pure functions from the text and selection to the change to make, so
// the editor can apply it as one undoable step.

export type Format =
  | "bold"
  | "italic"
  | "strike"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullets"
  | "numbered"
  | "checklist"
  | "quote"
  | "code"
  | "link"
  | "divider"
  | "table";

/** Replace `text.slice(start, end)` with `insert`, then select `selectStart`–`selectEnd` (positions in the new text). */
export interface Edit {
  start: number;
  end: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

const WRAPS: Partial<Record<Format, [string, string, string]>> = {
  // marker before, marker after, placeholder when nothing is selected
  bold: ["**", "**", "bold text"],
  italic: ["*", "*", "italic text"],
  strike: ["~~", "~~", "struck text"],
  code: ["`", "`", "code"],
};

const PREFIXES: Partial<Record<Format, string>> = {
  heading1: "# ",
  heading2: "## ",
  heading3: "### ",
  bullets: "- ",
  checklist: "- [ ] ",
  quote: "> ",
};

function wrap(text: string, start: number, end: number, before: string, after: string, placeholder: string): Edit {
  // Already wrapped (markers just outside or just inside the selection): unwrap.
  if (text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
    const inner = text.slice(start, end);
    return { start: start - before.length, end: end + after.length, insert: inner, selectStart: start - before.length, selectEnd: end - before.length };
  }
  const selected = text.slice(start, end);
  if (selected.length >= before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { start, end, insert: inner, selectStart: start, selectEnd: start + inner.length };
  }
  const inner = selected || placeholder;
  return { start, end, insert: `${before}${inner}${after}`, selectStart: start + before.length, selectEnd: start + before.length + inner.length };
}

// Markers a line can start with: a heading, a task, a bullet, a number or a quote. Adding one replaces another.
const LINE_MARKER = /^(#{1,6} |- \[[ xX]\] |[-*+] |\d{1,9}[.)] |> )/;

/** The first and last line of the selection, as [start of the first, end of the last]. */
function lineRange(text: string, start: number, end: number): [number, number] {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const at = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  return [lineStart, at < 0 ? text.length : at];
}

/** Numbers the selected lines 1., 2., 3. …, or takes the numbers off when every line has one. */
function numberLines(text: string, start: number, end: number): Edit {
  const [lineStart, lineEnd] = lineRange(text, start, end);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const numbered = /^\d{1,9}[.)] /;
  const remove = lines.every((line) => numbered.test(line));
  const insert = lines.map((line, i) => (remove ? line.replace(numbered, "") : `${i + 1}. ${line.replace(LINE_MARKER, "")}`)).join("\n");
  const single = lines.length === 1;
  return {
    start: lineStart,
    end: lineEnd,
    insert,
    selectStart: single ? Math.max(lineStart, start + insert.length - lines[0]!.length) : lineStart,
    selectEnd: single ? Math.max(lineStart, end + insert.length - lines[0]!.length) : lineStart + insert.length,
  };
}

/**
 * Puts a block (a divider or a table) on lines of its own after the selection, with a blank line before it, so that a
 * divider straight under text does not turn that text into a heading.
 */
function insertBlock(text: string, end: number, block: string, select: [number, number] | null): Edit {
  const before = text.slice(0, end);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const after = text.slice(end);
  const trail = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insert = lead + block + trail;
  const at = end + lead.length;
  const [from, to] = select ?? [block.length + trail.length, block.length + trail.length];
  return { start: end, end, insert, selectStart: at + from, selectEnd: at + to };
}

const TABLE = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |";

function prefixLines(text: string, start: number, end: number, prefix: string): Edit {
  const [lineStart, lineEnd] = lineRange(text, start, end);
  const lines = text.slice(lineStart, lineEnd).split("\n");
  // Every line already has it: take it off. Otherwise add it to the lines that lack it, replacing another list or
  // heading marker (a bullet becomes a checklist item, and so on).
  const remove = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) => (remove ? line.slice(prefix.length) : line.startsWith(prefix) ? line : prefix + line.replace(LINE_MARKER, "")));
  const insert = changed.join("\n");
  const single = lines.length === 1;
  return {
    start: lineStart,
    end: lineEnd,
    insert,
    // One line: keep the cursor where it was in the text; several: select them all.
    selectStart: single ? Math.max(lineStart, start + insert.length - lines[0]!.length) : lineStart,
    selectEnd: single ? Math.max(lineStart, end + insert.length - lines[0]!.length) : lineStart + insert.length,
  };
}

/** The change a toolbar button makes to the text around the selection. */
export function formatEdit(format: Format, text: string, start: number, end: number): Edit {
  const wrapWith = WRAPS[format];
  if (format === "code" && text.slice(start, end).includes("\n")) {
    const selected = text.slice(start, end);
    const insert = "```\n" + selected.replace(/\n$/, "") + "\n```";
    return { start, end, insert, selectStart: start + 4, selectEnd: start + 4 + selected.replace(/\n$/, "").length };
  }
  if (wrapWith) return wrap(text, start, end, ...wrapWith);
  if (format === "numbered") return numberLines(text, start, end);
  // The first header is selected, to type over.
  if (format === "table") return insertBlock(text, end, TABLE, [2, 2 + "Column 1".length]);
  if (format === "divider") return insertBlock(text, end, "---", null);
  const prefix = PREFIXES[format];
  if (prefix) return prefixLines(text, start, end, prefix);
  // A link: the selection becomes the link text, and the address placeholder is selected to type over.
  const label = text.slice(start, end) || "link text";
  const insert = `[${label}](https://)`;
  const urlStart = start + label.length + 3;
  return { start, end, insert, selectStart: urlStart, selectEnd: urlStart + "https://".length };
}

/** Applies an edit to a string (for tests, and for editors that cannot insert text natively). */
export function applyEdit(text: string, edit: Edit): string {
  return text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
}

// A task-list item's marker as it starts in the text: the bullet or number, then `[ ]` or `[x]`.
const TASK = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/;

/** Ticks or unticks the task-list item whose list marker starts at `offset`; null when no item starts there. */
export function toggleTask(text: string, offset: number): string | null {
  const match = TASK.exec(text.slice(offset));
  if (!match) return null;
  const box = offset + match[0].length - 2;
  return text.slice(0, box) + (match[1] === " " ? "x" : " ") + text.slice(box + 1);
}
