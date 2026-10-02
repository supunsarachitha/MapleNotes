import { AttachmentDecryptor, HEADER_SIZE } from "../crypto/attachments";
import { api } from "../lib/api";
import { ALL_KINDS } from "../lib/kinds";
import { unlockedSession } from "../lib/noteCrypto";
import type { Attachment, Note, NoteState } from "../lib/types";
import { buildExport, exportFileName, type ExportOptions, type ExportSource } from "./exporter";

// Exporting in the browser (accounts whose notes only the browser can read): reading the account through the API,
// and saving the archive. With the media service worker the archive is streamed to the download as it is built
// (/e2ee/export/{id}), so nothing is held in memory whole; without it, the archive is assembled in memory first.

const BATCH_CHUNKS = 16; // 1 MiB of an encrypted file per request

async function* readPlain(attachment: Attachment): AsyncGenerator<Uint8Array> {
  const response = await fetch(attachment.url, { credentials: "same-origin" });
  if (!response.ok || !response.body) throw new Error(`The file could not be read (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

async function* readEndToEnd(attachment: Attachment): AsyncGenerator<Uint8Array> {
  const session = unlockedSession();
  if (!session) throw new Error("Unlock your notes first.");
  const ranged = async (start: number, end: number) => {
    const response = await fetch(attachment.url, { credentials: "same-origin", headers: { Range: `bytes=${start}-${end}` } });
    if (response.status !== 206) throw new Error(`The file could not be read (HTTP ${response.status}).`);
    return response;
  };
  const head = await ranged(0, HEADER_SIZE - 1);
  const total = Number(/\/(\d+)$/.exec(head.headers.get("Content-Range") ?? "")?.[1]);
  const decryptor = await AttachmentDecryptor.create(
    session.keys, session.userId, attachment.id, new Uint8Array(await head.arrayBuffer()), total);
  for (let first = 0; first < decryptor.chunkCount; first += BATCH_CHUNKS) {
    const last = Math.min(decryptor.chunkCount - 1, first + BATCH_CHUNKS - 1);
    const range = decryptor.cipherRange(first, last);
    yield decryptor.decryptChunks(first, new Uint8Array(await (await ranged(range.start, range.end - 1)).arrayBuffer()));
  }
}

/** Reads the signed-in account through the API, decrypting as it goes. */
export function apiExportSource(account: string, onNotes?: (count: number) => void): ExportSource {
  return {
    account,
    async notes(includeArchived) {
      const all: Note[] = [];
      for (const state of (includeArchived ? ["active", "archived"] : ["active"]) as NoteState[]) {
        let cursor: string | undefined;
        do {
          const page = await api.listNotes({ state, cursor, limit: 100, kinds: ALL_KINDS }); // everything
          all.push(...page.items);
          onNotes?.(all.length);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      return all;
    },
    labels: () => api.labels.list(),
    openAttachment: (attachment) => (attachment.endToEnd ? readEndToEnd(attachment) : readPlain(attachment)),
  };
}

/** How long the worker has to start pulling before the export is built in memory instead. */
const WORKER_START_TIMEOUT_MS = 10_000;

/**
 * Streams the chunks to a download served by the media service worker. The download is opened in a hidden iframe:
 * browsers do not pass downloads started by <a download> to service workers, but they do pass navigations. Returns
 * false, with nothing consumed, when there is no worker or it does not take the download over in time.
 */
async function streamThroughWorker(fileName: string, chunks: AsyncGenerator<Uint8Array>): Promise<boolean> {
  const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (!worker) return false;

  const id = crypto.randomUUID();
  const channel = new MessageChannel();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  let started = false;

  const outcome = new Promise<boolean>((resolve, reject) => {
    const giveUp = setTimeout(() => {
      if (started) return;
      channel.port1.close();
      frame.remove();
      resolve(false);
    }, WORKER_START_TIMEOUT_MS);

    channel.port1.onmessage = async (event: MessageEvent<string>) => {
      if (event.data === "ready") {
        frame.src = `/e2ee/export/${id}`;
        document.body.append(frame);
      } else if (event.data === "pull") {
        started = true;
        clearTimeout(giveUp);
        try {
          const next = await chunks.next();
          channel.port1.postMessage(next.done ? { done: true } : { chunk: next.value });
          if (next.done) resolve(true);
        } catch (error) {
          channel.port1.postMessage({ error: error instanceof Error ? error.message : String(error) });
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      } else if (event.data === "cancel") {
        void chunks.return(undefined);
        resolve(true);
      }
    };
  });

  worker.postMessage({ type: "export", id, fileName }, [channel.port2]);
  const streamed = await outcome;
  setTimeout(() => frame.remove(), 60_000); // removing it at once could abort the download in some browsers
  return streamed;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Builds the export in the browser and saves it. Resolves once the whole archive has been handed to the download. */
export async function saveExport(options: ExportOptions, source: ExportSource): Promise<void> {
  const now = new Date();
  const fileName = exportFileName(options, now);
  const chunks = buildExport(source, options, now);
  if (await streamThroughWorker(fileName, chunks)) return;
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  saveBlob(new Blob(parts as BlobPart[], { type: "application/zip" }), fileName);
}
