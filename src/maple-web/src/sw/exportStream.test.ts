// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exportResponse, registerExport } from "./exportStream";

// The worker's streamed export download, driven like the page drives it over a MessageChannel.
describe("export stream", () => {
  it("streams the chunks the page produces into one download, only once", async () => {
    const channel = new MessageChannel();
    const pieces = [new Uint8Array([80, 75]), new Uint8Array([3, 4])];
    const ready = new Promise<void>((resolve) => {
      channel.port1.onmessage = (event: MessageEvent<string>) => {
        if (event.data === "ready") resolve();
        if (event.data === "pull") {
          const chunk = pieces.shift();
          channel.port1.postMessage(chunk ? { chunk } : { done: true });
        }
      };
    });

    registerExport("abc", "maple notes 2026-09-29.zip", channel.port2);
    await ready;
    const response = exportResponse("abc");
    const body = new Uint8Array(await response.arrayBuffer());
    channel.port1.close();

    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''maple%20notes%202026-09-29.zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([...body]).toEqual([80, 75, 3, 4]);
    expect(exportResponse("abc").status).toBe(404);
    expect(exportResponse("unknown").status).toBe(404);
  });

  it("fails the download when the page reports an error", async () => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<string>) => {
      if (event.data === "pull") channel.port1.postMessage({ error: "boom" });
    };

    registerExport("err", "x.zip", channel.port2);
    const failed = await exportResponse("err").arrayBuffer().catch((error: unknown) => error);
    channel.port1.close();

    expect(failed).toBeInstanceOf(Error);
  });
});
