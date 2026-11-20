import { Link } from "../lib/router";
import { EmptyState } from "./ui";

/** Shown instead of a tab whose feature is turned off; its notes are kept. */
export function FeatureOff({ title, children }: { title: string; children: string }) {
  return (
    <EmptyState title={title}>
      {children}{" "}
      <Link href="/settings" className="font-medium text-maple-700 underline dark:text-maple-400">
        Turn it on in Settings.
      </Link>
    </EmptyState>
  );
}
