import { DEFAULT_APP_NAME, useBranding } from "../lib/branding";
import { useAuthStatus } from "../lib/queries";

/** Which version the server runs, at the foot of Settings and Help; shown to signed-in users only. */
export function VersionNote() {
  const version = useAuthStatus().data?.version;
  const { appName } = useBranding();
  if (!version) return null;
  return (
    <p className="mt-8 text-center text-xs text-stone-500 dark:text-stone-400">
      {appName === DEFAULT_APP_NAME ? `Maple Notes ${version}` : `${appName} · Maple Notes ${version}`}
    </p>
  );
}
