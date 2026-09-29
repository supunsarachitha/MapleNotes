import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { utf8, uuidN } from "../crypto/encoding";
import { isInlineImage } from "../lib/media";
import type { Attachment, Note } from "../lib/types";
import type { JsonValue } from "./dotnet";
import { extension, kindName, manifestJson, render, type ExportedAttachment, type ExportFormat } from "./format";
import { folder, relativePath, safeFileName, slug, unique, type ExportLayout } from "./naming";
import { asLocalDate, dateOnly, fileStamp, parseUtc, timestamp, toZone, utcSortKey } from "./zone";

// Builds the export archive in the browser, for accounts whose notes only the browser can read. It reproduces the
// server's export (Features/Export/NoteExporter.cs) entry by entry, which export.test.ts checks against the server's
// own archives (export-vectors.json). The archive is produced as a stream of chunks, pulled by the download, so
// memory use stays bounded however large the account is.

export interface ExportOptions {
  format: ExportFormat;
  layout: ExportLayout;
  includeArchived: boolean;
  includeAttachments: boolean;
  /** First creation date included (yyyy-MM-dd, in the time zone), or null. */
  from: string | null;
  /** Last creation date included (yyyy-MM-dd, in the time zone), or null. */
  to: string | null;
  /** IANA time zone for folders, file names and timestamps. */
  timeZone: string;
}

/** Where the export reads from. */
export interface ExportSource {
  account: string;
  /** Every note (with archived ones when asked), decrypted, in any order. */
  notes(includeArchived: boolean): Promise<Note[]>;
  /** An attachment's decrypted content, in pieces; throws if the stored file cannot be read or is damaged. */
  openAttachment(attachment: Attachment): AsyncIterable<Uint8Array>;
}

/** The download's file name, e.g. maple-notes-2026-09-28.zip. */
export function exportFileName(options: ExportOptions, now: Date): string {
  return `maple-notes-${dateOnly(toZone(now, options.timeZone))}.zip`;
}

// Media and archives are already compressed; compressing them again only costs time.
function alreadyCompressed(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return (
    (type.startsWith("image/") && type !== "image/svg+xml") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    ["application/zip", "application/gzip", "application/x-7z-compressed", "application/pdf"].includes(type)
  );
}

/** Todo lists and quick notes get their own top-level folders; timeline notes stay at the top. */
const KIND_FOLDERS: Record<Note["kind"], string> = { Note: "", Todo: "todo", Quick: "quick-notes" };

function compareNotes(a: Note, b: Note): number {
  const byTime = utcSortKey(a.createdAtUtc).localeCompare(utcSortKey(b.createdAtUtc));
  return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Streams the export archive. */
export async function* buildExport(source: ExportSource, options: ExportOptions, now: Date): AsyncGenerator<Uint8Array> {
  const output: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else output.push(chunk);
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (output.length > 0) yield output.shift()!;
  }

  const zone = options.timeZone;
  const used = new Set<string>();
  unique("manifest.json", used);
  const problems: string[] = [];
  const manifestNotes: JsonValue[] = [];
  let attachmentCount = 0;

  const notes = (await source.notes(options.includeArchived))
    .filter((note) => options.includeArchived || !note.isArchived)
    .filter((note) => {
      const date = dateOnly(toZone(parseUtc(note.createdAtUtc), zone));
      return (!options.from || date >= options.from) && (!options.to || date <= options.to);
    })
    .sort(compareNotes);

  for (const note of notes) {
    const createdAt = parseUtc(note.createdAtUtc);
    const updatedAt = parseUtc(note.updatedAtUtc);
    const created = toZone(createdAt, zone);
    const updated = toZone(updatedAt, zone);
    const name = `${fileStamp(created)}_${slug(note.content)}.${extension(options.format)}`;
    const place = [KIND_FOLDERS[note.kind], folder(options.layout, created)].filter(Boolean).join("/");
    const notePath = unique(place ? `${place}/${name}` : name, used);

    const attachments: ExportedAttachment[] = [];
    if (options.includeAttachments) {
      const ordered = [...note.attachments].sort((a, b) => utcSortKey(a.createdAtUtc).localeCompare(utcSortKey(b.createdAtUtc)));
      for (const attachment of ordered) {
        const archivePath = unique(`attachments/${uuidN(attachment.id).slice(-8)}_${safeFileName(attachment.fileName)}`, used);
        const pieces = source.openAttachment(attachment)[Symbol.asyncIterator]();
        let first: IteratorResult<Uint8Array>;
        try {
          first = await pieces.next();
        } catch {
          problems.push(`${archivePath}: the stored file could not be read, so it was left out.`);
          continue;
        }

        const mtime = asLocalDate(toZone(parseUtc(attachment.createdAtUtc), zone));
        const entry = alreadyCompressed(attachment.contentType)
          ? new ZipPassThrough(archivePath)
          : new ZipDeflate(archivePath, { level: 1 });
        entry.mtime = mtime;
        zip.add(entry);
        let piece = first;
        try {
          while (!piece.done) {
            entry.push(piece.value);
            yield* drain();
            piece = await pieces.next();
          }
        } catch {
          problems.push(`${archivePath}: the stored file is damaged, so this copy is incomplete.`);
        }
        entry.push(new Uint8Array(0), true);
        yield* drain();

        attachments.push({
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          isImage: isInlineImage(attachment.contentType),
          archivePath,
          relativePath: relativePath(notePath, archivePath),
        });
      }
    }

    attachmentCount += attachments.length;
    const text = render(
      {
        id: note.id,
        content: note.content,
        created,
        updated,
        editedAfterMs: updatedAt.getTime() - createdAt.getTime(),
        tags: note.tags,
        pinned: note.isPinned,
        archived: note.isArchived,
        attachments,
        kind: note.kind,
        dailyDate: note.dailyDate ?? null,
      },
      options.format,
    );
    const entry = new ZipDeflate(notePath, { level: 6 });
    entry.mtime = asLocalDate(updated);
    zip.add(entry);
    entry.push(utf8(text), true);
    yield* drain();

    manifestNotes.push({
      id: note.id,
      path: notePath,
      kind: kindName(note.kind),
      dailyDate: note.dailyDate ?? null,
      createdAt: timestamp(created),
      tags: note.tags,
      archived: note.isArchived,
      attachments: attachments.map((a) => a.archivePath),
    });
  }

  const exportedAt = toZone(now, zone);
  const manifest = new ZipDeflate("manifest.json", { level: 6 });
  manifest.mtime = asLocalDate(exportedAt);
  zip.add(manifest);
  manifest.push(
    utf8(
      manifestJson({
        application: "Maple Notes",
        manifestVersion: 2, // 2: notes record their kind and daily date
        exportedAt: timestamp(exportedAt),
        account: source.account,
        options: {
          format: options.format,
          layout: options.layout,
          timeZone: zone,
          includeArchived: options.includeArchived,
          includeAttachments: options.includeAttachments,
          from: options.from,
          to: options.to,
        },
        noteCount: manifestNotes.length,
        attachmentCount,
        problems,
        notes: manifestNotes,
      }),
    ),
    true,
  );
  zip.end();
  yield* drain();
}
