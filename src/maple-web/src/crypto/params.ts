// Argon2id parameters and their limits (docs/e2ee-spec.md §1). Kept apart from argon2.ts so that checking parameters
// does not load the WebAssembly code, which normally runs only inside the worker.

export interface KdfParams {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  /** 16-byte salt. */
  salt: Uint8Array;
}

export const DEFAULT_KDF = { memoryKiB: 65536, iterations: 3, parallelism: 1 } as const;

const LIMITS = {
  minMemoryKiB: 19456,
  maxMemoryKiB: 1_048_576,
  minIterations: 2,
  maxIterations: 10,
  minParallelism: 1,
  maxParallelism: 4,
};

/** Refuses parameters that are too weak (or absurdly expensive), whoever supplied them. */
export function validateKdf(params: KdfParams): void {
  const ok =
    params.salt.length === 16 &&
    params.memoryKiB >= LIMITS.minMemoryKiB &&
    params.memoryKiB <= LIMITS.maxMemoryKiB &&
    params.iterations >= LIMITS.minIterations &&
    params.iterations <= LIMITS.maxIterations &&
    params.parallelism >= LIMITS.minParallelism &&
    params.parallelism <= LIMITS.maxParallelism;
  if (!ok) throw new Error("The password derivation settings are not acceptable.");
}
