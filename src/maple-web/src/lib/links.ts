// Finds the web links in a note, for link previews.

const URL_PATTERN = /https?:\/\/[^\s<>()"'`[\]]+/gi;
const FENCED = /```[\s\S]*?```|`[^`\n]*`/g;

/** The first `max` distinct http(s) links in Markdown text, leaving out code and links to this app. */
export function linksIn(markdown: string, max = 2): string[] {
  const found: string[] = [];
  for (const match of markdown.replace(FENCED, " ").matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?*_~]+$/, "");
    try {
      const parsed = new URL(url);
      if (typeof window !== "undefined" && parsed.origin === window.location.origin) continue;
    } catch {
      continue;
    }
    if (!found.includes(url)) found.push(url);
    if (found.length === max) break;
  }
  return found;
}
