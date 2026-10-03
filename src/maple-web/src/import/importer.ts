import { api, uploadAttachment } from "../lib/api";
import { ApiError, isStorageFull } from "../lib/apiError";
import { nextLabelColor } from "../lib/labels";
import type { LabelColor } from "../lib/types";
import type { ImportItem } from "./parse";

export interface ImportProgress {
  total: number;
  done: number;
  imported: number;
  /** Notes the account already had. */
  skipped: number;
  files: number;
  /** Labels created for the restored notes (labels the account has already are reused, matched by name). */
  labels: number;
  /** Notes (or their files) that could not be restored, with the reason. */
  failed: Array<{ source: string; reason: string }>;
  /** Why the restore stopped before the end: the account's storage is full, so the rest would fail too. */
  stopped?: string;
}

const reason = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : String(error));

/** The most labels a note can carry (the server checks the same). */
const MAX_LABELS_PER_NOTE = 20;

/** How label names are matched: ignoring case and surrounding spaces, as two labels of an account cannot differ by. */
const labelKey = (name: string) => name.trim().toLocaleLowerCase();

type ImportApi = Pick<typeof api, "existingNotes" | "importNote" | "deleteAttachment"> & { labels: Pick<typeof api.labels, "list" | "create"> };

/**
 * The account's label IDs for every label name the notes carry, by name key: an existing label of the same name, or a
 * new one in the colour the export recorded. A label that cannot be created (for example past the account's limit) is
 * reported, and the notes are restored without it.
 */
async function resolveLabels(
  items: ImportItem[],
  colors: ReadonlyMap<string, LabelColor>,
  labelsApi: ImportApi["labels"],
  progress: ImportProgress,
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const name of items.flatMap((item) => item.labels)) {
    if (name.trim() && !wanted.has(labelKey(name))) wanted.set(labelKey(name), name.trim());
  }
  const ids = new Map<string, string>();
  if (wanted.size === 0) return ids;

  let all;
  try {
    all = await labelsApi.list();
  } catch (error) {
    progress.failed.push({ source: "Labels", reason: `${reason(error)} The notes are restored without their labels.` });
    return ids;
  }
  for (const label of all) {
    if (!label.unreadable && !ids.has(labelKey(label.name))) ids.set(labelKey(label.name), label.id);
  }
  for (const [key, name] of wanted) {
    if (ids.has(key)) continue;
    try {
      const label = await labelsApi.create(name, colors.get(key) ?? nextLabelColor(all));
      all = [...all, label];
      ids.set(key, label.id);
      progress.labels++;
    } catch (error) {
      progress.failed.push({ source: `Label “${name}”`, reason: `${reason(error)} Notes are restored without it.` });
    }
  }
  return ids;
}

/**
 * Restores notes one after another: notes the account already has are skipped, the labels the others carry are found
 * or created by name, each note's files are uploaded (encrypted in the browser for end-to-end accounts, like any
 * upload), then the note is created with its original ID, dates, state and labels. A note that fails is reported and the rest carry on, unless the account's storage is full: then the
 * restore stops, and running it again once there is room picks up where it stopped.
 */
export async function runImport(
  items: ImportItem[],
  onProgress: (progress: ImportProgress) => void,
  deps: { api: ImportApi; upload: typeof uploadAttachment | null } = { api, upload: uploadAttachment },
  labelColors: ReadonlyMap<string, LabelColor> = new Map(),
): Promise<ImportProgress> {
  const progress: ImportProgress = { total: items.length, done: 0, imported: 0, skipped: 0, files: 0, labels: 0, failed: [] };
  const report = () => onProgress({ ...progress, failed: [...progress.failed] });
  report();

  const ids = [...new Set(items.flatMap((item) => (item.id ? [item.id.toLowerCase()] : [])))];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const id of await deps.api.existingNotes(ids.slice(i, i + 500))) existing.add(id.toLowerCase());
  }
  const isNew = (item: ImportItem) => !item.id || !existing.has(item.id.toLowerCase());
  const labelIds = await resolveLabels(items.filter(isNew), labelColors, deps.api.labels, progress);
  if (progress.failed.length > 0) report();

  for (const item of items) {
    if (!isNew(item)) {
      progress.skipped++;
    } else {
      const uploaded: string[] = [];
      try {
        // No uploads: a notebook kept on the device holds no files, so its notes are restored without them.
        const upload = deps.upload;
        if (upload) {
          for (const attachment of item.attachments) {
            const file = new File([(await attachment.read()) as BlobPart], attachment.name, { type: attachment.type });
            uploaded.push((await upload(file, () => undefined)).id);
          }
        }
        const noteLabels = [...new Set(item.labels.flatMap((name) => labelIds.get(labelKey(name)) ?? []))];
        const result = await deps.api.importNote(item, uploaded, noteLabels.slice(0, MAX_LABELS_PER_NOTE));
        if (result.imported) {
          progress.imported++;
          progress.files += uploaded.length;
        } else {
          progress.skipped++; // restored meanwhile (another tab): its files are not needed
          for (const id of uploaded) void deps.api.deleteAttachment(id).catch(() => undefined);
        }
        if (item.id) existing.add(item.id.toLowerCase());
        if (!upload && item.attachments.length > 0) {
          progress.failed.push({ source: item.source, reason: "Restored without its files: a notebook on this device cannot hold files." });
        }
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
