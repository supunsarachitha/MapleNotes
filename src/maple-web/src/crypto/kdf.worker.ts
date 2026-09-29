/// <reference lib="webworker" />
import { argon2Master } from "./argon2";
import type { KdfParams } from "./params";

// Runs Argon2id off the main thread (it takes a moment and uses 64 MiB of memory by design).
self.onmessage = async (event: MessageEvent<{ id: number; password: string; params: KdfParams }>) => {
  const { id, password, params } = event.data;
  const scope = self as unknown as Worker;
  try {
    const master = await argon2Master(password, params);
    scope.postMessage({ id, master }, [master.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
