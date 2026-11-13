import { useMutation } from "@tanstack/react-query";
import { useAuthStatus } from "../lib/queries";
import { type AppVerification, isIntact, verifyApp } from "../lib/verifyApp";
import { Button, ErrorMessage, Section } from "./ui";

const RELEASES_URL = "https://github.com/supunsarachitha/MapleNotes/releases";

/** Settings → About: the version this server runs and "Verify this app" (lib/verifyApp.ts). */
export function AboutSection() {
  const version = useAuthStatus().data?.version;
  // Hashing every file of the app takes a moment, so it runs only when asked.
  const check = useMutation({ mutationFn: () => verifyApp() });

  return (
    <Section title="About" description={version ? `This server runs Maple Notes ${version}.` : undefined}>
      <h3 className="text-sm font-medium">Verify this app</h3>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        Compares the files your browser loaded with the list of file fingerprints published for this version. It finds files
        that were changed on the way, for example by a proxy or an extension.
      </p>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
        A server that was taken over can fake this check as well, because it also delivers this page. The strong check runs
        outside the browser, against the signed list attached to each{" "}
        <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          release on GitHub
        </a>
        , with the script described in the README under “Checking the web app”.
      </p>
      <div className="mt-3">
        <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Verify this app"}
        </Button>
      </div>
      {check.isError && (
        <div className="mt-3">
          <ErrorMessage>The app could not be checked.</ErrorMessage>
        </div>
      )}
      {check.data && <VerifyResult result={check.data} serverVersion={version} />}
    </Section>
  );
}

function VerifyResult({ result, serverVersion }: { result: AppVerification; serverVersion?: string | null }) {
  if (result.kind === "unavailable") {
    return (
      <p role="status" className="mt-3 text-sm text-stone-700 dark:text-stone-200">
        {result.reason}
      </p>
    );
  }
  const intact = isIntact(result);
  const problems: [path: string, reason: string][] = [
    ...result.changed.map((path) => [path, "different from the list"] as [string, string]),
    ...result.missing.map((path) => [path, "could not be loaded"] as [string, string]),
    ...result.unlisted.map((path) => [path, "loaded, but not on the list"] as [string, string]),
  ];
  return (
    <div role="status" className="mt-3 text-sm">
      {intact ? (
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          All {result.checked} files match the list for Maple Notes {result.version}.
        </p>
      ) : (
        <>
          <p className="font-medium text-red-700 dark:text-red-400">
            {problems.length === 1 ? "1 file does not match" : `${problems.length} files do not match`} the list for Maple Notes{" "}
            {result.version}. Do not enter your password or recovery key until the server's administrator has looked at this.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-700 dark:text-stone-200">
            {problems.map(([path, reason]) => (
              <li key={`${path} ${reason}`}>
                <span className="break-all font-mono text-xs">{path}</span>: {reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {serverVersion && serverVersion !== result.version && (
        <p className="mt-2 text-red-700 dark:text-red-400">
          The server says it runs {serverVersion}, but the list is for {result.version}.
        </p>
      )}
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        Fingerprint of the list (SHA-256): <span className="break-all font-mono">{result.fingerprint}</span>. It should equal
        the digest GitHub shows for <span className="whitespace-nowrap font-mono">build-manifest.json</span> on the release
        page.
      </p>
    </div>
  );
}
