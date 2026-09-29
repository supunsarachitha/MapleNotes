import { useId, type ReactNode } from "react";
import { formatDate } from "../lib/dates";
import { usePreferences, useUpdatePreferences } from "../lib/preferences";
import { DATE_FORMATS, type DateFormat, type Preferences } from "../lib/types";
import { useToast } from "./Toaster";
import { Section, Switch } from "./ui";

/** A switch with its label and explanation, for one preference. */
function PreferenceSwitch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p id={id} className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">
          {description}
        </p>
      </div>
      <Switch label={label} describedBy={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** Saves preference changes, telling the user when one could not be saved (it is then undone). */
function useSavePreferences() {
  const update = useUpdatePreferences();
  const toast = useToast();
  return (changes: Partial<Preferences>) =>
    update.mutate(changes, { onError: () => toast.error("Your setting could not be saved. Please try again.") });
}

/** Which tabs and cards the app shows. Turning one off hides it but keeps its notes. */
export function FeaturesSection() {
  const preferences = usePreferences();
  const save = useSavePreferences();

  return (
    <Section title="Features" description="Turning a feature off hides it; nothing is deleted.">
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        <PreferenceSwitch
          label="Todo lists"
          description="A Todo tab for checklists you create and tick off."
          checked={preferences.todoLists}
          onChange={(todoLists) => save({ todoLists })}
        />
        <PreferenceSwitch
          label="Quick notes"
          description="A Quick notes tab: a scratchpad for short notes that stay out of your timeline."
          checked={preferences.quickNotes}
          onChange={(quickNotes) => save({ quickNotes })}
        />
        <PreferenceSwitch
          label="Daily notes"
          description="Show today's note at the top of Home, titled with the date. It is saved the first time you write in it, so days you skip leave no empty notes."
          checked={preferences.dailyNotes}
          onChange={(dailyNotes) => save({ dailyNotes })}
        />
        <PreferenceSwitch
          label="Calendar"
          description="A month calendar in the side menu. Days with notes are marked; choose one to see its notes."
          checked={preferences.calendar}
          onChange={(calendar) => save({ calendar })}
        />
      </div>
    </Section>
  );
}

/** Titles, and dates in titles and daily notes. */
export function WritingSection() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const formatId = useId();
  const today = new Date();

  return (
    <Section title="Writing">
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        <PreferenceSwitch
          label="Note titles"
          description="Add a title field when you write. The title is saved as the note's first line, as a heading, so it also appears in searches and exports."
          checked={preferences.noteTitles}
          onChange={(noteTitles) => save({ noteTitles })}
        />
        <PreferenceSwitch
          label="Start titles with today's date"
          description={preferences.noteTitles ? "New notes get today's date as their title, which you can change." : "Turn on note titles to use this."}
          checked={preferences.dateInTitles}
          disabled={!preferences.noteTitles}
          onChange={(dateInTitles) => save({ dateInTitles })}
        />
        <div className="flex flex-col gap-1.5 py-3 last:pb-0">
          <label htmlFor={formatId} className="text-sm font-medium">
            Date format
          </label>
          <select
            id={formatId}
            value={preferences.dateFormat}
            onChange={(event) => save({ dateFormat: event.target.value as DateFormat })}
            className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-base dark:border-stone-700 dark:bg-stone-950"
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {formatDate(today, format)}
              </option>
            ))}
          </select>
          <p className="text-sm text-stone-600 dark:text-stone-300">Used for dates in titles and for daily notes.</p>
        </div>
      </div>
    </Section>
  );
}
