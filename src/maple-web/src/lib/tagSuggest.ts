import type { Tag } from "./types";

// Suggesting existing tags while a #tag is typed. The rules for where a tag can start mirror crypto/content.ts and the
// server's TagParser: a "#" not preceded by a letter, digit, "_", "/", "#" or "&".

/** The most suggestions shown at once. */
export const MAX_SUGGESTIONS = 6;

/** A #tag being typed: where its "#" is and what follows it, up to the caret. */
export interface TagQuery {
  /** Offset of the "#". */
  start: number;
  /** What was typed after the "#", lower case (may be empty). */
  text: string;
}

const PARTIAL_TAG = /(?<![\p{L}\p{N}_/#&])#([\p{L}\p{N}_][\p{L}\p{N}_/-]{0,63})?$/u;

/**
 * The tag being typed just before the caret, or null when the caret is not right after "#" and a partial tag (inside
 * code, the text before is not checked: a suggestion there is harmless).
 */
export function tagQueryAt(text: string, caret: number): TagQuery | null {
  const before = text.slice(0, caret);
  const match = PARTIAL_TAG.exec(before);
  if (!match) return null;
  // The tag must end at the caret: a letter right after it means the caret is inside a word.
  if (/^[\p{L}\p{N}_/-]/u.test(text.slice(caret))) return null;
  return { start: match.index, text: (match[1] ?? "").toLowerCase() };
}

/**
 * Tags that match what was typed, best first: those starting with it, then those with a nested part starting with it
 * (`meet` finds `work/meetings`), each group by how many notes use them. An exact match alone is no suggestion.
 */
export function suggestTags(tags: Tag[], typed: string, limit = MAX_SUGGESTIONS): Tag[] {
  const rank = (tag: Tag) => {
    if (tag.name.startsWith(typed)) return 0;
    if (tag.name.split("/").some((part) => part.startsWith(typed))) return 1;
    return -1;
  };
  const matches = tags
    .map((tag) => ({ tag, rank: rank(tag) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.tag.noteCount - a.tag.noteCount || a.tag.name.localeCompare(b.tag.name))
    .map((entry) => entry.tag)
    .slice(0, limit);
  return matches.length === 1 && matches[0]!.name === typed ? [] : matches;
}

/** The text with the partial tag replaced by the whole tag and a space, and where the caret goes after it. */
export function insertTag(text: string, query: TagQuery, caret: number, tag: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const spacer = after.startsWith(" ") || after.startsWith("\n") ? "" : " ";
  const inserted = `#${tag}${spacer}`;
  return { text: text.slice(0, query.start) + inserted + after, caret: query.start + inserted.length + (spacer ? 0 : 1) };
}
