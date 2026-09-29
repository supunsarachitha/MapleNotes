import { jsonString, serializeJson, trimEnd, type JsonValue } from "./dotnet";
import { linkTarget } from "./naming";
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
}

export interface ExportedNote {
  id: string;
  content: string;
  created: ZonedTime;
  updated: ZonedTime;
  /** Updated minus created, in milliseconds. */
  editedAfterMs: number;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  attachments: ExportedAttachment[];
}

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
  text += `created: ${timestamp(note.created)}\n`;
  text += `updated: ${timestamp(note.updated)}\n`;
  text += `tags: [${note.tags.map(jsonString).join(", ")}]\n`;
  text += `pinned: ${note.pinned}\n`;
  text += `archived: ${note.archived}\n`;
  if (note.attachments.length > 0) {
    text += "attachments:\n";
    for (const attachment of note.attachments) text += `  - ${jsonString(attachment.relativePath)}\n`;
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
  if (note.tags.length > 0) text += `Tags: ${note.tags.map((tag) => `#${tag}`).join(" ")}\n`;
  if (note.pinned || note.archived) {
    text += `State: ${[note.pinned ? "pinned" : null, note.archived ? "archived" : null].filter(Boolean).join(", ")}\n`;
  }
  for (const attachment of note.attachments) text += `Attachment: ${attachment.relativePath}\n`;
  return `${text}\n${trimEnd(note.content)}\n`;
}

export function json(note: ExportedNote): string {
  return `${serializeJson({
    id: note.id,
    createdAt: timestamp(note.created),
    updatedAt: timestamp(note.updated),
    tags: note.tags,
    pinned: note.pinned,
    archived: note.archived,
    content: note.content,
    attachments: note.attachments.map((a) => ({ fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, path: a.relativePath })),
  })}\n`;
}

export function manifestJson(manifest: JsonValue): string {
  return `${serializeJson(manifest)}\n`;
}
