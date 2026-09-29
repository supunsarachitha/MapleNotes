import { fromUtf8 } from "../crypto/encoding";
import type { NoteKind } from "../lib/types";
import { readZip, type ZipEntry } from "./zip";

// Reads what a restore brings in: Maple Notes export archives (every format and folder layout, with their
// attachments) and single Markdown, text or JSON files. The formats are the ones the exporters write
// (src/export/format.ts and the server's NoteFormatter.cs); the export's manifest.json lists every note with its ID,
// so even plain-text exports restore under their original IDs.

export interface ImportAttachment {
  name: string;
  type: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface ImportItem {
  /** Where the note came from, for messages: a file name or a path inside an archive. */
  source: string;
  /** The note's original ID, or null for a file that is not from Maple Notes. */
  id: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  pinned: boolean;
  archived: boolean;
  kind: NoteKind;
  dailyDate: string | null;
  attachments: ImportAttachment[];
  /** Attached files the note mentions that are not in the archive. */
  missing: string[];
}

export interface ImportPlan {
  items: ImportItem[];
  /** Files that could not be read. */
  problems: string[];
}

/** File types a restore accepts. */
export const IMPORT_ACCEPT = ".zip,.md,.markdown,.txt,.json";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  zip: "application/zip",
};

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const guessType = (name: string) => TYPES[extensionOf(name)] ?? "application/octet-stream";
const KINDS: Record<string, NoteKind> = { note: "Note", todo: "Todo", quick: "Quick" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isNoteFile = (name: string) => ["md", "markdown", "txt", "json"].includes(extensionOf(name));
const withoutBom = (text: string) => (text.startsWith("﻿") ? text.slice(1) : text);

/** What a note file says about itself, before its attachments are found. */
interface ParsedNote {
  id: string | null;
  content: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  pinned: boolean;
  archived: boolean;
  kind: NoteKind;
  dailyDate: string | null;
  /** Attachment paths relative to the note file, with their original names and types when the format keeps them. */
  attachments: Array<{ path: string; name?: string; type?: string }>;
}

const date = (value: unknown) => {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};
const day = (value: unknown) => (typeof value === "string" && DATE.test(value) ? value : null);
const kind = (value: unknown) => KINDS[typeof value === "string" ? value.toLowerCase() : ""] ?? "Note";
const jsonString = (value: string) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
};

/** Markdown with the export's front matter; null if the file has none. */
function parseMarkdown(text: string): ParsedNote | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return null;
  const fields = new Map<string, string>();
  const paths: string[] = [];
  let inAttachments = false;
  for (const line of text.slice(4, end).split("\n")) {
    const item = /^ {2}- (.*)$/.exec(line);
    if (inAttachments && item) {
      const path = jsonString(item[1]!);
      if (path) paths.push(path);
      continue;
    }
    const field = /^([a-z]+):\s?(.*)$/.exec(line);
    if (!field) continue;
    inAttachments = field[1] === "attachments";
    fields.set(field[1]!, field[2]!);
  }
  if (!fields.has("created")) return null;

  let body = text.slice(end + 5);
  if (body.startsWith("\n")) body = body.slice(1);
  let content = body.endsWith("\n") ? body.slice(0, -1) : body;
  const names: string[] = [];
  const section = body.lastIndexOf("\n## Attachments\n\n");
  if (paths.length > 0 && section >= 0 && (section === 0 || body[section - 1] === "\n")) {
    content = body.slice(0, Math.max(0, section - 1));
    for (const line of body.slice(section + 17).split("\n")) {
      const link = /^- !?\[((?:\\.|[^\]\\])*)\]\(/.exec(line);
      if (link) names.push(link[1]!.replace(/\\([\\[\]])/g, "$1"));
    }
  }

  return {
    id: UUID.test(fields.get("id") ?? "") ? fields.get("id")! : null,
    content,
    createdAt: date(fields.get("created")),
    updatedAt: date(fields.get("updated")),
    pinned: fields.get("pinned") === "true",
    archived: fields.get("archived") === "true",
    kind: kind(fields.get("kind")),
    dailyDate: day(fields.get("daily")),
    attachments: paths.map((path, i) => ({ path, name: names.length === paths.length ? names[i] : undefined })),
  };
}

/** Plain text with the export's header lines; null if the file does not start with one. */
function parsePlainText(text: string): ParsedNote | null {
  if (!text.startsWith("Created: ")) return null;
  const split = text.indexOf("\n\n");
  const header = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? "" : text.slice(split + 2);
  const fields = new Map<string, string>();
  const paths: string[] = [];
  for (const line of header.split("\n")) {
    const field = /^([A-Za-z]+): (.*)$/.exec(line);
    if (!field) continue;
    if (field[1] === "Attachment") paths.push(field[2]!);
    else fields.set(field[1]!, field[2]!);
  }
  const state = fields.get("State") ?? "";
  const created = date(fields.get("Created"));
  return {
    id: null,
    content: body.endsWith("\n") ? body.slice(0, -1) : body,
    createdAt: created,
    updatedAt: date(fields.get("Updated")) ?? created,
    pinned: state.includes("pinned"),
    archived: state.includes("archived"),
    kind: kind(fields.get("Kind")),
    dailyDate: day(fields.get("Daily")),
    attachments: paths.map((path) => ({ path })),
  };
}

/** One note as JSON, as the export writes it; null for any other JSON. */
function parseJson(text: string): ParsedNote | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || typeof (value as { content?: unknown }).content !== "string") return null;
  const note = value as Record<string, unknown>;
  const attachments = Array.isArray(note.attachments) ? (note.attachments as Array<Record<string, unknown>>) : [];
  return {
    id: typeof note.id === "string" && UUID.test(note.id) ? note.id : null,
    content: note.content as string,
    createdAt: date(note.createdAt),
    updatedAt: date(note.updatedAt),
    pinned: note.pinned === true,
    archived: note.archived === true,
    kind: kind(note.kind),
    dailyDate: day(note.dailyDate),
    attachments: attachments
      .filter((a) => typeof a.path === "string")
      .map((a) => ({
        path: a.path as string,
        name: typeof a.fileName === "string" ? a.fileName : undefined,
        type: typeof a.contentType === "string" ? a.contentType : undefined,
      })),
  };
}

/** Reads a note file in any export format; anything else becomes a note with the file's text. */
function parseNote(name: string, text: string, modified: Date): ParsedNote {
  const clean = withoutBom(text).replace(/\r\n/g, "\n");
  const extension = extensionOf(name);
  const parsed =
    extension === "json" ? parseJson(clean) : extension === "txt" ? parsePlainText(clean) : parseMarkdown(clean);
  if (parsed) return parsed;
  if (extension === "json") throw new Error("This JSON file is not a Maple Notes note.");
  return { id: null, content: clean, createdAt: modified, updatedAt: modified, pinned: false, archived: false, kind: "Note", dailyDate: null, attachments: [] };
}

/** Resolves a path relative to a file inside the archive, e.g. ../attachments/x from 2026-09/note.md. */
function resolve(fromFile: string, relative: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** An exported attachment's original name: exports prefix it with 8 characters of its ID. */
const originalName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/^[0-9a-f]{8}_/, "");

function toItem(source: string, parsed: ParsedNote, fallbackTime: Date, entries: Map<string, ZipEntry> | null, manifest?: ManifestNote): ImportItem {
  const attachments: ImportAttachment[] = [];
  const missing: string[] = [];
  for (const attachment of parsed.attachments) {
    const path = resolve(source, attachment.path);
    const entry = entries?.get(path);
    if (!entry) {
      missing.push(attachment.name ?? originalName(path));
      continue;
    }
    const name = attachment.name ?? originalName(path);
    attachments.push({ name, type: attachment.type ?? guessType(name), size: entry.size, read: () => entry.read() });
  }
  const createdAt = parsed.createdAt ?? date(manifest?.createdAt) ?? fallbackTime;
  return {
    source,
    id: manifest?.id && UUID.test(manifest.id) ? manifest.id : parsed.id,
    content: parsed.content,
    createdAt,
    updatedAt: parsed.updatedAt ?? createdAt,
    pinned: parsed.pinned,
    archived: parsed.archived || manifest?.archived === true,
    kind: manifest?.kind ? kind(manifest.kind) : parsed.kind,
    dailyDate: parsed.dailyDate ?? day(manifest?.dailyDate),
    attachments,
    missing,
  };
}

interface ManifestNote {
  id?: string;
  path?: string;
  createdAt?: string;
  archived?: boolean;
  kind?: string;
  dailyDate?: string | null;
}

async function readArchive(file: File, plan: ImportPlan): Promise<void> {
  const entries = new Map((await readZip(file)).map((entry) => [entry.name, entry] as const));
  const modified = new Date(file.lastModified);
  const manifestEntry = entries.get("manifest.json");
  let listed: ManifestNote[] | null = null;
  if (manifestEntry) {
    try {
      const manifest = JSON.parse(fromUtf8(await manifestEntry.read())) as { application?: string; notes?: ManifestNote[] };
      if (manifest.application === "Maple Notes" && Array.isArray(manifest.notes)) listed = manifest.notes;
    } catch {
      plan.problems.push(`${file.name}: manifest.json could not be read; its notes are read without it.`);
    }
  }

  // A Maple Notes export: exactly the notes its manifest lists. Any other archive: every note file in it.
  const notes: Array<{ path: string; manifest?: ManifestNote }> = listed
    ? listed.filter((n) => typeof n.path === "string").map((n) => ({ path: n.path!, manifest: n }))
    : [...entries.keys()].filter((name) => isNoteFile(name) && !name.startsWith("attachments/") && !name.startsWith("__MACOSX/")).map((path) => ({ path }));

  for (const { path, manifest } of notes) {
    const entry = entries.get(path);
    if (!entry) {
      plan.problems.push(`${file.name}: ${path} is listed but missing.`);
      continue;
    }
    try {
      plan.items.push(toItem(path, parseNote(path, fromUtf8(await entry.read()), modified), modified, entries, manifest));
    } catch (error) {
      plan.problems.push(`${file.name}: ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Reads the chosen files: export archives and single note files. */
export async function readImport(files: File[]): Promise<ImportPlan> {
  const plan: ImportPlan = { items: [], problems: [] };
  for (const file of files) {
    try {
      if (extensionOf(file.name) === "zip") {
        await readArchive(file, plan);
      } else if (isNoteFile(file.name)) {
        const modified = new Date(file.lastModified);
        plan.items.push(toItem(file.name, parseNote(file.name, await file.text(), modified), modified, null));
      } else {
        plan.problems.push(`${file.name}: choose .zip, .md, .txt or .json files.`);
      }
    } catch (error) {
      plan.problems.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plan;
}
