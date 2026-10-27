import { jsonString, serializeJson, trimEnd, type JsonValue } from "./dotnet";
import { linkTarget } from "./naming";
import type { NoteKind } from "../lib/types";
import { timestamp, type ZonedTime } from "./zone";

// How exported notes are written, identical to the server's (Features/Export/NoteFormatter.cs).

export type ExportFormat = "md" | "txt" | "json";

export interface ExportedAttachment {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  archivePath: string;
  relativePath: string;
  /** A sticker, listed once more under stickers. */
  isSticker: boolean;
}

export interface ExportedNote {
  id: string;
  content: string;
  created: ZonedTime;
  updated: ZonedTime;
  /** Updated minus created, in milliseconds. */
  editedAfterMs: number;
  tags: string[];
  /** The names of the note's labels, in ordinal order. */
  labels: string[];
  pinned: boolean;
  archived: boolean;
  attachments: ExportedAttachment[];
  kind: NoteKind;
  /** For a daily note, its day (yyyy-MM-dd). */
  dailyDate: string | null;
  /** The mood's name in lower case (awful … great), or null for none: then nothing about it is written. */
  mood: string | null;
}

/** The stickers among a note's files; none for most notes, which are then written exactly as before stickers. */
const stickersOf = (note: ExportedNote) => note.attachments.filter((a) => a.isSticker);

/** The kind as written in exports: note, todo or quick. */
export const kindName = (kind: NoteKind) => kind.toLowerCase();

export function extension(format: ExportFormat): string {
  return format;
}

export function render(note: ExportedNote, format: ExportFormat): string {
  return format === "txt" ? plainText(note) : format === "json" ? json(note) : markdown(note);
}

const escapeLinkText = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");

/** Markdown with YAML front matter; YAML accepts JSON strings, which avoids every YAML quoting pitfall. */
export function markdown(note: ExportedNote): string {
  let text = "---\n";
  text += `id: ${note.id}\n`;
  text += `kind: ${kindName(note.kind)}\n`;
  if (note.dailyDate) text += `daily: ${note.dailyDate}\n`;
  text += `created: ${timestamp(note.created)}\n`;
  text += `updated: ${timestamp(note.updated)}\n`;
  text += `tags: [${note.tags.map(jsonString).join(", ")}]\n`;
  text += `labels: [${note.labels.map(jsonString).join(", ")}]\n`;
  text += `pinned: ${note.pinned}\n`;
  text += `archived: ${note.archived}\n`;
  if (note.mood) text += `mood: ${note.mood}\n`;
  if (note.attachments.length > 0) {
    text += "attachments:\n";
    for (const attachment of note.attachments) text += `  - ${jsonString(attachment.relativePath)}\n`;
  }
  const stickers = stickersOf(note);
  if (stickers.length > 0) {
    // Which of the files above are stickers; readers from before stickers read the first list only.
    text += "stickers:\n";
    for (const sticker of stickers) text += `  - ${jsonString(sticker.relativePath)}\n`;
  }
  text += "---\n\n";
  text += `${trimEnd(note.content)}\n`;
  if (note.attachments.length > 0) {
    text += "\n## Attachments\n\n";
    for (const attachment of note.attachments) {
      const link = `[${escapeLinkText(attachment.fileName)}](${linkTarget(attachment.relativePath)})`;
      text += attachment.isImage ? `- !${link}\n` : `- ${link}\n`;
    }
  }
  return text;
}

/** Plain text: a short header, a blank line, then the note. */
export function plainText(note: ExportedNote): string {
  let text = `Created: ${timestamp(note.created)}\n`;
  if (note.editedAfterMs > 60_000) text += `Updated: ${timestamp(note.updated)}\n`;
  if (note.kind !== "Note") text += `Kind: ${kindName(note.kind)}\n`;
  if (note.dailyDate) text += `Daily: ${note.dailyDate}\n`;
  if (note.tags.length > 0) text += `Tags: ${note.tags.map((tag) => `#${tag}`).join(" ")}\n`;
  // As a JSON array: label names may contain spaces and commas.
  if (note.labels.length > 0) text += `Labels: [${note.labels.map(jsonString).join(", ")}]\n`;
  if (note.pinned || note.archived) {
    text += `State: ${[note.pinned ? "pinned" : null, note.archived ? "archived" : null].filter(Boolean).join(", ")}\n`;
  }
  if (note.mood) text += `Mood: ${note.mood}\n`;
  for (const attachment of note.attachments) text += `Attachment: ${attachment.relativePath}\n`;
  for (const sticker of stickersOf(note)) text += `Sticker: ${sticker.relativePath}\n`;
  return `${text}\n${trimEnd(note.content)}\n`;
}

export function json(note: ExportedNote): string {
  // As Falcon Notes 1.7.0 defined them: the mood after "archived", the stickers' paths last; both only when present.
  const stickers = stickersOf(note);
  return `${serializeJson({
    id: note.id,
    kind: kindName(note.kind),
    dailyDate: note.dailyDate,
    createdAt: timestamp(note.created),
    updatedAt: timestamp(note.updated),
    tags: note.tags,
    labels: note.labels,
    pinned: note.pinned,
    archived: note.archived,
    ...(note.mood ? { mood: note.mood } : {}),
    content: note.content,
    attachments: note.attachments.map((a) => ({ fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, path: a.relativePath })),
    ...(stickers.length > 0 ? { stickers: stickers.map((s) => s.relativePath) } : {}),
  })}\n`;
}

export function manifestJson(manifest: JsonValue): string {
  return `${serializeJson(manifest)}\n`;
}
