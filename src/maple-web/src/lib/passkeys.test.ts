import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromBase64, toBase64 } from "../crypto/encoding";
import { createPasskey, evaluatePasskey, getPasskey, PasskeyCancelled, passkeysSupported, PasskeyUnavailable } from "./passkeys";
import type { PasskeyCreationOptions, PasskeyRequestOptions } from "./types";

class FakeCredential {
  constructor(
    readonly rawId: ArrayBuffer,
    readonly response: object,
  ) {}
}

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const creation: PasskeyCreationOptions = {
  challengeId: "c1",
  challenge: toBase64(new Uint8Array([1, 2, 3])),
  rp: { id: "localhost", name: "Maple Notes" },
  user: { id: toBase64(new Uint8Array([9, 9])), name: "maple", displayName: "Maple" },
  algorithms: [-7, -257],
  excludeCredentials: [{ id: toBase64(new Uint8Array([7])), transports: ["internal"] }],
  timeoutMs: 120000,
};
const request: PasskeyRequestOptions = { challengeId: "r1", challenge: toBase64(new Uint8Array([4, 5])), rpId: "localhost", timeoutMs: 120000 };

let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  create = vi.fn();
  get = vi.fn();
  vi.stubGlobal("PublicKeyCredential", FakeCredential);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "credentials", { value: { create, get }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "credentials", { value: undefined, configurable: true });
});

describe("passkeys in the browser", () => {
  it("is available only with WebAuthn in a secure context", () => {
    expect(passkeysSupported()).toBe(true);
    vi.stubGlobal("isSecureContext", false);
    expect(passkeysSupported()).toBe(false);
  });

  it("creates a discoverable, user-verified passkey without attestation and sends its parts as base64", async () => {
    create.mockResolvedValue(
      new FakeCredential(bytes(0xaa), {
        clientDataJSON: bytes(1),
        getAuthenticatorData: () => bytes(2),
        getPublicKey: () => bytes(3),
        getPublicKeyAlgorithm: () => -7,
        getTransports: () => ["internal", "hybrid"],
      }),
    );

    const { credential: wire, prf } = await createPasskey(creation);

    const { publicKey } = create.mock.calls[0]![0] as { publicKey: PublicKeyCredentialCreationOptions };
    expect(new Uint8Array(publicKey.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(publicKey.user.id as ArrayBuffer)).toEqual(new Uint8Array([9, 9]));
    expect(publicKey.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }]);
    expect(publicKey.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(publicKey.attestation).toBe("none");
    expect((publicKey.extensions as { prf?: unknown }).prf).toBeDefined();
    expect(prf).toEqual({ enabled: false, output: null });
    expect(new Uint8Array(publicKey.excludeCredentials![0]!.id as ArrayBuffer)).toEqual(new Uint8Array([7]));
    expect(wire).toEqual({
      id: toBase64(new Uint8Array([0xaa])),
      clientDataJson: toBase64(new Uint8Array([1])),
      authenticatorData: toBase64(new Uint8Array([2])),
      publicKey: toBase64(new Uint8Array([3])),
      publicKeyAlgorithm: -7,
      transports: ["internal", "hybrid"],
    });
  });

  it("asks a browser without getPublicKey to update", async () => {
    create.mockResolvedValue(new FakeCredential(bytes(1), { clientDataJSON: bytes(1) }));
    await expect(createPasskey(creation)).rejects.toBeInstanceOf(PasskeyUnavailable);
  });

  it("signs in with any passkey for the site, quietly through autofill when asked", async () => {
    get.mockResolvedValue(
      new FakeCredential(bytes(0xbb), { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: bytes(4) }),
    );
    const controller = new AbortController();

    const { credential: wire, prfOutput } = await getPasskey(request, { autofill: true, signal: controller.signal });
    expect(prfOutput).toBeNull();

    const options = get.mock.calls[0]![0] as CredentialRequestOptions;
    expect(options.mediation).toBe("conditional");
    expect(options.signal).toBe(controller.signal);
    expect(options.publicKey!.allowCredentials).toEqual([]);
    expect(options.publicKey!.userVerification).toBe("required");
    expect(fromBase64(wire.signature)).toEqual(new Uint8Array([3]));
    expect(wire.userHandle).toBe(toBase64(new Uint8Array([4])));
  });

  it("treats a closed prompt as cancelled and explains other refusals", async () => {
    get.mockRejectedValue(new DOMException("closed", "NotAllowedError"));
    await expect(getPasskey(request)).rejects.toBeInstanceOf(PasskeyCancelled);

    create.mockRejectedValue(new DOMException("exists", "InvalidStateError"));
    await expect(createPasskey(creation)).rejects.toThrow("This device already has a passkey for your account.");
  });
});

describe("the PRF extension", () => {
  it("returns a passkey's 32-byte PRF output, on creation and on use", async () => {
    const output = new Uint8Array(32).fill(7);
    const withPrf = (response: object) =>
      Object.assign(new FakeCredential(bytes(1), response), { getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: output.buffer } } }) });
    create.mockResolvedValue(withPrf({
      clientDataJSON: bytes(1), getAuthenticatorData: () => bytes(2), getPublicKey: () => bytes(3), getPublicKeyAlgorithm: () => -7,
    }));
    get.mockResolvedValue(withPrf({ clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null }));

    expect((await createPasskey(creation)).prf).toEqual({ enabled: true, output });
    expect((await getPasskey(request)).prfOutput).toEqual(output);
  });

  it("asks only the given passkeys when unlocking, and refuses one without PRF", async () => {
    get.mockResolvedValue(new FakeCredential(bytes(5), { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null }));

    await expect(evaluatePasskey([toBase64(new Uint8Array([5]))])).rejects.toBeInstanceOf(PasskeyUnavailable);
    const { publicKey } = get.mock.calls[0]![0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(new Uint8Array(publicKey.allowCredentials![0]!.id as ArrayBuffer)).toEqual(new Uint8Array([5]));
  });
});
