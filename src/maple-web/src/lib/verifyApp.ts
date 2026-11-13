/**
 * "Verify this app" (Settings → About): compares the files the browser loaded with the build manifest the server
 * publishes at /build-manifest.json, the same file that is attached to the release on GitHub and signed there.
 *
 * This only catches a change the manifest does not account for: a reverse proxy or extension that injects a script, an
 * instance built from modified sources but serving the stock manifest, a half-finished upgrade. A server that changes
 * the app on purpose can change this check too, so the strong test runs outside the browser
 * (scripts/verify-instance.py) against the signed manifest of the release. The page says so.
 */

export const MANIFEST_PATH = "/build-manifest.json";

export interface BuildManifest {
  app: "maple-notes";
  version: string;
  algorithm: "sha256";
  files: Record<string, string>;
}

export type AppVerification =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "checked";
      version: string;
      /** SHA-256 of the manifest file itself, to compare with the digest GitHub shows for the release's asset. */
      fingerprint: string;
      checked: number;
      changed: string[];
      missing: string[];
      /** Scripts and styles this page loaded from its own origin that the manifest does not list. */
      unlisted: string[];
    };

export function isIntact(result: AppVerification): boolean {
  return result.kind === "checked" && result.changed.length + result.missing.length + result.unlisted.length === 0;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseManifest(text: string): BuildManifest | null {
  try {
    const value = JSON.parse(text) as Partial<BuildManifest> | null;
    if (
      value?.app === "maple-notes" &&
      value.algorithm === "sha256" &&
      typeof value.version === "string" &&
      value.files !== null &&
      typeof value.files === "object"
    ) {
      return value as BuildManifest;
    }
  } catch {
    // Falls through: not JSON.
  }
  return null;
}

/** Same-origin scripts and styles the page has loaded, as paths (e.g. /assets/index-abc.js). */
export function loadedAppFiles(): string[] {
  const urls = [
    ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"), (script) => script.src),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"]'), (link) => link.href),
    ...performance
      .getEntriesByType("resource")
      .filter((entry) => ["script", "link", "css", "other"].includes((entry as PerformanceResourceTiming).initiatorType))
      .map((entry) => entry.name),
  ];
  const paths = new Set<string>();
  for (const url of urls) {
    const parsed = new URL(url, location.href);
    if (parsed.origin === location.origin && /\.(m?js|css|wasm)$/.test(parsed.pathname)) paths.add(parsed.pathname);
  }
  return [...paths].sort();
}

/**
 * Fetches the manifest and every file it lists, and hashes them. Files are fetched as the browser normally would, so
 * the long-cached, fingerprinted assets come from the cache or the service worker, which is what the page runs.
 */
export async function verifyApp(fetchFile: typeof fetch = fetch, loaded: string[] = loadedAppFiles()): Promise<AppVerification> {
  let response: Response;
  try {
    response = await fetchFile(MANIFEST_PATH, { cache: "no-store" });
  } catch {
    return { kind: "unavailable", reason: "The build manifest could not be loaded." };
  }
  if (!response.ok) {
    return { kind: "unavailable", reason: "This server does not publish a build manifest. Development builds do not have one." };
  }
  const bytes = await response.arrayBuffer();
  const manifest = parseManifest(new TextDecoder().decode(bytes));
  if (!manifest) return { kind: "unavailable", reason: "The build manifest this server sends is not valid." };

  const paths = Object.keys(manifest.files).sort();
  const changed: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        const file = await fetchFile(path);
        if (!file.ok) missing.push(path);
        else if ((await sha256Hex(await file.arrayBuffer())) !== manifest.files[path]) changed.push(path);
      } catch {
        missing.push(path);
      }
    }),
  );
  return {
    kind: "checked",
    version: manifest.version,
    fingerprint: await sha256Hex(bytes),
    checked: paths.length,
    changed: changed.sort(),
    missing: missing.sort(),
    unlisted: loaded.filter((path) => !(path in manifest.files)),
  };
}
