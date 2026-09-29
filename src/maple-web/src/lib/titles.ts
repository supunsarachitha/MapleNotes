// A note's title is its first line written as a Markdown heading (`# Title`). Storing it in the text keeps titles
// working everywhere the text goes: encryption, search, exports and imports.

const HEADING = /^# +(.*?)(?: +#+)? *$/;

/** Splits a note's text into its title (the first line, if it is a `# heading`) and the rest. */
export function splitTitle(content: string): { title: string; body: string } {
  const newline = content.indexOf("\n");
  const first = (newline < 0 ? content : content.slice(0, newline)).replace(/\r$/, "");
  const match = HEADING.exec(first);
  if (!match || !match[1]!.trim()) return { title: "", body: content };
  const rest = newline < 0 ? "" : content.slice(newline + 1);
  return { title: match[1]!.trim(), body: rest.replace(/^\r?\n/, "") };
}

/** Puts a title in front of a note's text as a `# heading`; an empty title leaves the text as it is. */
export function joinTitle(title: string, body: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return body;
  return body.trim() ? `# ${clean}\n\n${body}` : `# ${clean}`;
}
