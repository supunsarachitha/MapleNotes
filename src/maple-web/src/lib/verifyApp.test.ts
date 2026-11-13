import { describe, expect, it } from "vitest";
import { isIntact, MANIFEST_PATH, verifyApp } from "./verifyApp";

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const indexHtml = '<script type="module" src="/assets/index-abc.js"></script>';
const indexJs = "console.log('maple')";
const files: Record<string, string> = {
  "/index.html": indexHtml,
  "/assets/index-abc.js": indexJs,
  "/sw.js": "self.addEventListener('fetch', () => {})",
};

async function manifestFor(served: Record<string, string>, version = "1.22.0") {
  const hashes: Record<string, string> = {};
  for (const [path, text] of Object.entries(served)) hashes[path] = await sha256(text);
  return JSON.stringify({ app: "maple-notes", version, algorithm: "sha256", files: hashes });
}

/** A fetch that serves `site` and records the options each request used. */
function server(site: Record<string, string>) {
  const requests: { path: string; init?: RequestInit }[] = [];
  const fetchFile = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    requests.push({ path, init });
    const body = site[path];
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : new Response(body));
  }) as typeof fetch;
  return { fetchFile, requests };
}

describe("verifyApp", () => {
  it("reports a stock app as intact, with the manifest's fingerprint", async () => {
    const manifest = await manifestFor(files);
    const { fetchFile, requests } = server({ ...files, [MANIFEST_PATH]: manifest });

    const result = await verifyApp(fetchFile, ["/assets/index-abc.js"]);

    expect(result).toEqual({
      kind: "checked",
      version: "1.22.0",
      fingerprint: await sha256(manifest),
      checked: 3,
      changed: [],
      missing: [],
      unlisted: [],
    });
    expect(isIntact(result)).toBe(true);
    // The manifest bypasses every cache; the app's own files are read the way the page loaded them.
    expect(requests.find((request) => request.path === MANIFEST_PATH)?.init).toEqual({ cache: "no-store" });
  });

  it("names a changed file, a missing file and a loaded script the manifest does not list", async () => {
    const manifest = await manifestFor(files);
    const { fetchFile } = server({
      [MANIFEST_PATH]: manifest,
      "/index.html": indexHtml,
      "/assets/index-abc.js": `${indexJs};fetch("https://attacker.example/")`,
    });

    const result = await verifyApp(fetchFile, ["/assets/index-abc.js", "/assets/injected.js"]);

    expect(result).toMatchObject({
      kind: "checked",
      changed: ["/assets/index-abc.js"],
      missing: ["/sw.js"],
      unlisted: ["/assets/injected.js"],
    });
    expect(isIntact(result)).toBe(false);
  });

  it("says so when the server has no manifest or sends something else", async () => {
    expect(await verifyApp(server({}).fetchFile, [])).toEqual({
      kind: "unavailable",
      reason: "This server does not publish a build manifest. Development builds do not have one.",
    });
    const bogus = server({ [MANIFEST_PATH]: JSON.stringify({ files: {} }) });
    expect(await verifyApp(bogus.fetchFile, [])).toEqual({
      kind: "unavailable",
      reason: "The build manifest this server sends is not valid.",
    });
  });
});
