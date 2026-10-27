import { NOTE_MOODS, type NoteMood } from "../lib/types";
import { cn } from "./ui";

/** Each mood's smiley, drawn by the device's emoji font (as in Falcon Notes). */
export const MOOD_EMOJI: Record<NoteMood, string> = { Awful: "😢", Bad: "🙁", Okay: "😐", Good: "🙂", Great: "😄" };

/**
 * The five smilies to choose a note's mood from, worst to best. Each is a toggle: choosing the one already chosen takes
 * the mood off, so there is no sixth button for "none".
 */
export function MoodPicker({ id, value, onChange }: { id: string; value: NoteMood | null; onChange: (mood: NoteMood | null) => void }) {
  return (
    <div id={id} role="group" aria-label="Mood" className="mt-2 flex items-center gap-1 border-t border-stone-100 pt-2 dark:border-stone-800">
      {NOTE_MOODS.map((mood) => {
        const chosen = mood === value;
        return (
          <button
            key={mood}
            type="button"
            aria-pressed={chosen}
            aria-label={mood}
            title={mood}
            onClick={() => onChange(chosen ? null : mood)}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500",
              chosen ? "bg-maple-100 ring-2 ring-maple-500 dark:bg-maple-600/20" : "hover:bg-stone-100 dark:hover:bg-stone-800",
            )}
          >
            <span aria-hidden="true">{MOOD_EMOJI[mood]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A note's mood where it is shown, after its time: the smiley, named for screen readers. */
export function MoodBadge({ mood }: { mood: NoteMood }) {
  return (
    <span role="img" aria-label={`Mood: ${mood}`} title={`Mood: ${mood}`} className="text-base leading-none">
      {MOOD_EMOJI[mood]}
    </span>
  );
}
