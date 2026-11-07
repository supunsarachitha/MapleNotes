import { fromBase64, toBase64, type Bytes } from "../crypto/encoding";
import { PASSKEY_PRF_SALT } from "../crypto/passkey";
import type { PasskeyCreationOptions, PasskeyRequestOptions } from "./types";

// WebAuthn in the browser. The server sends binary fields as base64 and checks the answers itself
// (src/MapleNotes.Server/Features/Passkeys/WebAuthn.cs); this file only converts between the two.

/** A new passkey, in the shape POST /api/v1/account/passkeys expects. */
export interface NewPasskeyWire {
  id: string;
  clientDataJson: string;
  authenticatorData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
  transports: string[];
}

/** A passkey's answer to a sign-in challenge, in the shape POST /api/v1/auth/passkey/login expects. */
export interface PasskeyAssertionWire {
  id: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
}

/** Thrown when the person closes the passkey prompt or it times out; not worth an error message. */
export class PasskeyCancelled extends Error {
  constructor() {
    super("The passkey prompt was closed.");
    this.name = "PasskeyCancelled";
  }
}

/** Thrown when the browser or the device cannot do what was asked; the message is safe to show. */
export class PasskeyUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyUnavailable";
  }
}

const buffer = (base64: string) => fromBase64(base64).buffer;

/** Asks the passkey for its PRF output for the fixed salt (docs/e2ee-spec.md §6a); ignored where unsupported. */
const prfExtension = { prf: { eval: { first: PASSKEY_PRF_SALT } } } as AuthenticationExtensionsClientInputs;

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } };
}

function prfResults(credential: PublicKeyCredential): PrfResults["prf"] {
  return typeof credential.getClientExtensionResults === "function"
    ? (credential.getClientExtensionResults() as PrfResults).prf
    : undefined;
}

function prfOutput(credential: PublicKeyCredential): Bytes | null {
  const first = prfResults(credential)?.results?.first;
  if (!first) return null;
  const view = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return view.length === 32 ? new Uint8Array(view) : null;
}

/** A new passkey, and what it said about the PRF extension, which can unlock end-to-end notes. */
export interface CreatedPasskey {
  credential: NewPasskeyWire;
  /** Whether the passkey supports PRF, and its output when it gave one straight away (not every device does). */
  prf: { enabled: boolean; output: Bytes | null };
}

/** A passkey's answer, and its PRF output when the device gives one. The output never goes to the server. */
export interface UsedPasskey {
  credential: PasskeyAssertionWire;
  prfOutput: Bytes | null;
}
const base64 = (data: ArrayBuffer) => toBase64(new Uint8Array(data));

/** Whether this browser has WebAuthn at all (it also needs HTTPS or localhost, which `isSecureContext` covers). */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function"
    && typeof navigator.credentials?.create === "function";
}

/** Whether the browser can offer passkeys in the username field's autofill list. */
export async function autofillSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> })
    .isConditionalMediationAvailable;
  return typeof check === "function" ? check.call(PublicKeyCredential).catch(() => false) : false;
}

function translate(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") return new PasskeyCancelled();
    if (error.name === "InvalidStateError") return new PasskeyUnavailable("This device already has a passkey for your account.");
    if (error.name === "SecurityError") {
      return new PasskeyUnavailable("Passkeys work only at the site's own address, over HTTPS.");
    }
    if (error.name === "NotSupportedError") return new PasskeyUnavailable("This device cannot create a passkey that works here.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Asks the browser to create a passkey for the options the server sent. */
export async function createPasskey(options: PasskeyCreationOptions): Promise<CreatedPasskey> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: buffer(options.challenge),
        rp: options.rp,
        user: { id: buffer(options.user.id), name: options.user.name, displayName: options.user.displayName },
        pubKeyCredParams: options.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
        excludeCredentials: options.excludeCredentials.map((c) => ({
          type: "public-key" as const,
          id: buffer(c.id),
          ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
        })),
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
        attestation: "none",
        timeout: options.timeoutMs,
        extensions: prfExtension,
      },
    });
  } catch (error) {
    throw translate(error);
  }
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelled();
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = typeof response.getPublicKey === "function" ? response.getPublicKey() : null;
  if (!publicKey || typeof response.getAuthenticatorData !== "function") {
    throw new PasskeyUnavailable("This browser is too old to add passkeys. Update it, or use another one.");
  }
  const output = prfOutput(credential);
  return {
    credential: {
      id: base64(credential.rawId),
      clientDataJson: base64(response.clientDataJSON),
      authenticatorData: base64(response.getAuthenticatorData()),
      publicKey: base64(publicKey),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
    prf: { enabled: output !== null || prfResults(credential)?.enabled === true, output },
  };
}

/**
 * Asks the browser for a passkey's answer to a sign-in challenge. With `autofill`, the request waits quietly until
 * the person picks a passkey from the username field's suggestions; abort it with `signal` before starting another.
 */
export async function getPasskey(
  options: PasskeyRequestOptions,
  { autofill = false, signal, allow = [] }: { autofill?: boolean; signal?: AbortSignal; allow?: string[] } = {},
): Promise<UsedPasskey> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: buffer(options.challenge),
        rpId: options.rpId,
        allowCredentials: allow.map((id) => ({ type: "public-key" as const, id: buffer(id) })),
        userVerification: "required",
        timeout: options.timeoutMs,
        extensions: prfExtension,
      },
      ...(autofill ? { mediation: "conditional" as CredentialMediationRequirement } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw translate(error);
  }
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelled();
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credential: {
      id: base64(credential.rawId),
      clientDataJson: base64(response.clientDataJSON),
      authenticatorData: base64(response.authenticatorData),
      signature: base64(response.signature),
      userHandle: response.userHandle ? base64(response.userHandle) : null,
    },
    prfOutput: prfOutput(credential),
  };
}

/**
 * Asks one of `credentialIds` for its PRF output, with a challenge made here: nothing is sent to the server, since the
 * output itself is the proof (it opens the wrapped key or it does not).
 */
export async function evaluatePasskey(credentialIds: string[], timeoutMs = 120_000): Promise<{ id: string; prfOutput: Bytes }> {
  const challenge = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const { credential, prfOutput } = await getPasskey({ challengeId: "", challenge, rpId: location.hostname, timeoutMs }, { allow: credentialIds });
  if (!prfOutput) throw new PasskeyUnavailable("This passkey cannot unlock your notes. Use your password instead.");
  return { id: credential.id, prfOutput };
}
