import { EmptyState } from "../components/ui";
import { usePreferences } from "../lib/preferences";
import { FeatureOff } from "./TodoPage";

/** The Habits tab: daily habits to tick off, and a chart of the progress. */
export function HabitsPage() {
  const { habitTracker } = usePreferences();

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Habits</h1>
      {habitTracker ? (
        <EmptyState title="No habits yet">Habits you add show here, with the last seven days to tick off.</EmptyState>
      ) : (
        <FeatureOff title="The habit tracker is turned off">Your habits are kept and come back when you turn it on again.</FeatureOff>
      )}
    </>
  );
}
