import { api, uploadAttachment } from "../lib/api";
import { ApiError, isStorageFull } from "../lib/apiError";
import type { ImportItem } from "./parse";

export interface ImportProgress {
  total: number;
  done: number;
  imported: number;
  /** Notes the account already had. */
  skipped: number;
  files: number;
  /** Notes (or their files) that could not be restored, with the reason. */
  failed: Array<{ source: string; reason: string }>;
  /** Why the restore stopped before the end: the account's storage is full, so the rest would fail too. */
  stopped?: string;
}

const reason = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : String(error));

/**
 * Restores notes one after another: notes the account already has are skipped, each note's files are uploaded first
 * (encrypted in the browser for end-to-end accounts, like any upload), then the note is created with its original ID,
 * dates and state. A note that fails is reported and the rest carry on, unless the account's storage is full: then the
 * restore stops, and running it again once there is room picks up where it stopped.
 */
export async function runImport(
  items: ImportItem[],
  onProgress: (progress: ImportProgress) => void,
  deps: { api: Pick<typeof api, "existingNotes" | "importNote" | "deleteAttachment">; upload: typeof uploadAttachment } = { api, upload: uploadAttachment },
): Promise<ImportProgress> {
  const progress: ImportProgress = { total: items.length, done: 0, imported: 0, skipped: 0, files: 0, failed: [] };
  const report = () => onProgress({ ...progress, failed: [...progress.failed] });
  report();

  const ids = [...new Set(items.flatMap((item) => (item.id ? [item.id.toLowerCase()] : [])))];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const id of await deps.api.existingNotes(ids.slice(i, i + 500))) existing.add(id.toLowerCase());
  }

  for (const item of items) {
    if (item.id && existing.has(item.id.toLowerCase())) {
      progress.skipped++;
    } else {
      const uploaded: string[] = [];
      try {
        for (const attachment of item.attachments) {
          const file = new File([(await attachment.read()) as BlobPart], attachment.name, { type: attachment.type });
          uploaded.push((await deps.upload(file, () => undefined)).id);
        }
        const result = await deps.api.importNote(item, uploaded);
        if (result.imported) {
          progress.imported++;
          progress.files += uploaded.length;
        } else {
          progress.skipped++; // restored meanwhile (another tab): its files are not needed
          for (const id of uploaded) void deps.api.deleteAttachment(id).catch(() => undefined);
        }
        if (item.id) existing.add(item.id.toLowerCase());
        if (item.missing.length > 0) {
          progress.failed.push({ source: item.source, reason: `Restored without ${item.missing.join(", ")}, which the archive does not contain.` });
        }
      } catch (error) {
        for (const id of uploaded) void deps.api.deleteAttachment(id).catch(() => undefined);
        if (isStorageFull(error)) {
          progress.stopped = error.message;
          report();
          return progress;
        }
        progress.failed.push({ source: item.source, reason: reason(error) });
      }
    }
    progress.done++;
    report();
  }
  return progress;
}
