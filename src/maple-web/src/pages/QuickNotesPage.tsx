import { FeatureOff } from "../components/FeatureOff";
import { useHomeShortcuts } from "../components/HomeHeader";
import { NoteCard } from "../components/NoteCard";
import { NoteList } from "../components/NoteList";
import { EmptyState } from "../components/ui";
import { usePreferences } from "../lib/preferences";
import { NewNoteButton } from "./HomePage";

/**
 * The Quick notes tab: a scratchpad kept out of the timeline. A quick note worth keeping moves to Home. As on Home,
 * the round + button (or N) writes a new one full screen.
 */
export function QuickNotesPage() {
  const { quickNotes, quickNoteTitles } = usePreferences();
  useHomeShortcuts();

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Quick notes</h1>
      {!quickNotes ? (
        <div className="mt-4">
          <FeatureOff title="Quick notes are turned off">Your quick notes are kept and come back when you turn them on again.</FeatureOff>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
            Jot things down without filling your timeline. Move a note to Home from its menu when it is worth keeping.
          </p>
          <NewNoteButton
            kind="Quick"
            label="New quick note"
            allowTitle={quickNoteTitles}
            placeholder="Jot something down…"
            defaultLabels={false}
          />
          {/* Room at the bottom so the + button never covers the last note. */}
          <div className="flex flex-col gap-6 pb-20">
            <NoteList
              state="pinned"
              kinds={["Quick"]}
              renderNote={(note) => <NoteCard note={note} showKind={false} />}
              showEndMarker={false}
              header={<h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Pinned</h2>}
            />
            <NoteList
              state="feed"
              kinds={["Quick"]}
              renderNote={(note) => <NoteCard note={note} showKind={false} />}
              empty={<EmptyState title="No quick notes">Anything you jot down here stays out of your timeline.</EmptyState>}
            />
          </div>
        </>
      )}
    </>
  );
}
