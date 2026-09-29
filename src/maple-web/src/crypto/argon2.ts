import { argon2id } from "hash-wasm";
import { concat, utf8, type Bytes } from "./encoding";

// Argon2id password derivation (docs/e2ee-spec.md §1). Imported by the Web Worker and, as a fallback, by kdf.ts.

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

/** Argon2id(NFC(password), salt) → 32-byte master secret. */
export async function argon2Master(password: string, params: KdfParams): Promise<Bytes> {
  validateKdf(params);
  const result = await argon2id({
    password: utf8(password.normalize("NFC")),
    salt: concat(params.salt),
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return concat(result);
}
