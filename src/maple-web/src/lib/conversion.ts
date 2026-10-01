import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { decryptAttachment, encryptAttachment } from "../crypto/attachments";
import { decryptLabelName, decryptMetadata, decryptNote, encryptLabelName, encryptMetadata } from "../crypto/content";
import { fromBase64, toBase64 } from "../crypto/encoding";
import { DecryptionError } from "../crypto/envelope";
import { api, ApiError, request } from "./api";
import { DOWNLOAD_CONTENT_TYPE } from "./media";
import { encryptForNote, unlockedSession } from "./noteCrypto";
import { queryKeys } from "./queries";
import type { ConversionBatch, User } from "./types";

// Converts existing content after a change to or from end-to-end encryption (docs/e2ee-spec.md §3). Only this browser
// holds the key, so it fetches batches from the server, converts each item and sends it back. Every item is converted
// on its own and progress lives on the server, so closing the tab or reloading simply resumes where it stopped.

const BATCH_SIZE = 10;

// Items that cannot be decrypted (damaged data). Like the server's own conversion, they are left as they are and
// skipped for the rest of this session, so they cannot hold up everything else; the account keeps its key for them.
const unconvertible = new Set<string>();

/** Skips an item that disappeared, was edited or was converted elsewhere; a later batch brings it back if needed. */
function skippable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}

async function fetchStored(id: string): Promise<Blob> {
  // Never from the cache: a cached copy may be from before an earlier conversion replaced the stored bytes.
  const response = await fetch(`/api/v1/attachments/${id}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, { title: "A file could not be read for conversion." });
  return response.blob();
}

async function convertNote(batch: ConversionBatch, note: ConversionBatch["notes"][number]): Promise<void> {
  const { userId, keys } = unlockedSession() ?? {};
  if (!userId || !keys) throw new ApiError(0, { title: "Unlock your notes first." });
  if (batch.mode === "EndToEnd") {
    await api.conversion.note(note.id, { updatedAtUtc: note.updatedAtUtc, encrypted: await encryptForNote(note.id, note.content ?? "") });
  } else {
    const content = await decryptNote(keys, userId, note.id, fromBase64(note.encryptedContent ?? ""));
    await api.conversion.note(note.id, { updatedAtUtc: note.updatedAtUtc, content });
  }
}

async function convertAttachment(batch: ConversionBatch, file: ConversionBatch["attachments"][number]): Promise<void> {
  const { userId, keys } = unlockedSession() ?? {};
  if (!userId || !keys) throw new ApiError(0, { title: "Unlock your notes first." });
  const stored = await fetchStored(file.id);
  const form = new FormData();
  if (batch.mode === "EndToEnd") {
    const metadata = { name: file.fileName ?? "file", type: file.contentType ?? DOWNLOAD_CONTENT_TYPE, size: stored.size };
    form.append("metadata", toBase64(await encryptMetadata(keys, userId, file.id, metadata)));
    form.append("file", await encryptAttachment(keys, userId, file.id, stored), "encrypted.bin");
  } else {
    const metadata = await decryptMetadata(keys, userId, file.id, fromBase64(file.encryptedMetadata ?? ""));
    const plain = await decryptAttachment(keys, userId, file.id, stored, metadata.type);
    form.append("file", new File([plain], metadata.name, { type: metadata.type }));
  }
  await api.conversion.attachment(file.id, form);
}

/** Saves a label's name again in the account's new form: encrypted for end-to-end mode, plain otherwise. */
async function convertLabel(batch: ConversionBatch, label: NonNullable<ConversionBatch["labels"]>[number]): Promise<void> {
  const { userId, keys } = unlockedSession() ?? {};
  if (!userId || !keys) throw new ApiError(0, { title: "Unlock your notes first." });
  const body =
    batch.mode === "EndToEnd"
      ? { encryptedName: toBase64(await encryptLabelName(keys, userId, label.id, label.name ?? "")) }
      : { name: await decryptLabelName(keys, userId, label.id, fromBase64(label.encryptedName ?? "")) };
  await request<void>("PUT", `/api/v1/labels/${label.id}`, body);
}

async function attempt(id: string, convert: () => Promise<void>): Promise<void> {
  try {
    await convert();
  } catch (error) {
    if (error instanceof DecryptionError) unconvertible.add(id);
    else if (!skippable(error)) throw error;
  }
}

/** Converts the next batch. Returns how many items were left before it, or 0 when there is nothing it can do. */
export async function convertNextBatch(): Promise<number> {
  const batch = await api.conversion.batch(Math.min(50, BATCH_SIZE + unconvertible.size));
  let attempted = 0;
  for (const note of batch.notes.filter((n) => !unconvertible.has(n.id))) {
    attempted++;
    await attempt(note.id, () => convertNote(batch, note));
  }
  for (const file of batch.attachments.filter((a) => !unconvertible.has(a.id))) {
    attempted++;
    await attempt(file.id, () => convertAttachment(batch, file));
  }
  for (const label of (batch.labels ?? []).filter((l) => !unconvertible.has(l.id))) {
    attempted++;
    await attempt(label.id, () => convertLabel(batch, label));
  }
  return attempted === 0 ? 0 : batch.remaining;
}

/** Whether this account may have content that only this browser can convert. */
export function mayNeedConversion(user: User | null, unlocked: boolean): boolean {
  return unlocked && user !== null && (user.encryptionMode === "EndToEnd" || user.hasEndToEndKey);
}

/**
 * Runs the conversion while the app is open: batch after batch until nothing is left, refreshing the progress shown
 * in Settings. Restarts whenever the mode changes; backs off after errors (offline, for example).
 */
export function useConversionRunner(user: User | null, unlocked: boolean): void {
  const queryClient = useQueryClient();
  const active = mayNeedConversion(user, unlocked);
  const mode = user?.encryptionMode;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void (async () => {
      let backoff = 0;
      let converted = false;
      while (!stopped) {
        try {
          const remaining = await convertNextBatch();
          await queryClient.invalidateQueries({ queryKey: queryKeys.encryption });
          if (remaining === 0) break;
          converted = true;
          backoff = 0;
        } catch {
          backoff = Math.min(backoff === 0 ? 2_000 : backoff * 2, 60_000);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
      if (converted && !stopped) {
        // Finished: the account may no longer need its end-to-end key, and every list shows converted items.
        await queryClient.invalidateQueries({ queryKey: queryKeys.status });
        await queryClient.invalidateQueries({ queryKey: queryKeys.notes });
        await queryClient.invalidateQueries({ queryKey: queryKeys.tags });
        await queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [active, mode, queryClient]);
}
