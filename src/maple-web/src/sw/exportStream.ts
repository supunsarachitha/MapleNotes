// The media service worker's side of browser exports: a download at /e2ee/export/{id} whose body the page produces
// chunk by chunk over a MessagePort ("pull" → { chunk } | { done } | { error }), so the archive streams to disk.

export const EXPORT_PREFIX = "/e2ee/export/";

interface PendingExport {
  fileName: string;
  port: MessagePort;
}

const pending = new Map<string, PendingExport>();

/** Remembers an export the page is about to download, and tells the page it may start. */
export function registerExport(id: string, fileName: string, port: MessagePort): void {
  pending.set(id, { fileName, port });
  port.postMessage("ready");
}

function disposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/** The download response for a registered export; each export can be downloaded once. */
export function exportResponse(id: string): Response {
  const entry = pending.get(id);
  if (!entry) return new Response(null, { status: 404 });
  pending.delete(id);
  const { port, fileName } = entry;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      return new Promise<void>((resolve) => {
        port.onmessage = (event: MessageEvent<{ chunk?: Uint8Array; done?: boolean; error?: string }>) => {
          if (event.data.chunk) controller.enqueue(event.data.chunk);
          else if (event.data.done) controller.close();
          else controller.error(new Error(event.data.error ?? "The export failed."));
          resolve();
        };
        port.postMessage("pull");
      });
    },
    cancel() {
      port.postMessage("cancel");
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition(fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
