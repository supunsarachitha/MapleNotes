import { argon2id } from "hash-wasm";
import { concat, utf8, type Bytes } from "./encoding";
import { validateKdf, type KdfParams } from "./params";

// Argon2id password derivation (docs/e2ee-spec.md §1). Runs in the Web Worker; kdf.ts loads it on the main thread
// only where workers are unavailable.

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
