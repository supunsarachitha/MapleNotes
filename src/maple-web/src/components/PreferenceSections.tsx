import { Monitor, Moon, Sun, TriangleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ACCENT_COLORS } from "../lib/appearance";
import { formatDate } from "../lib/dates";
import { usePreferences, useUpdatePreferences } from "../lib/preferences";
import { useAuthStatus } from "../lib/queries";
import { ACCENTS, DATE_FORMATS, MENU_TEXT_SIZES, THEMES, WEEK_STARTS, type DateFormat, type Preferences, type WeekStart } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toaster";
import { Section, Switch, cn } from "./ui";

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

const THEME_ICONS = { System: Monitor, Light: Sun, Dark: Moon } as const;

/** Light or dark, and the accent colour; saved for the account, so every device looks the same. */
export function AppearanceSection() {
  const id = useId();
  const preferences = usePreferences();
  const save = useSavePreferences();

  return (
    <Section title="Appearance">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((theme) => {
            const Icon = THEME_ICONS[theme];
            return (
              <label
                key={theme}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-maple-500",
                  preferences.theme === theme
                    ? "border-maple-600 bg-maple-50 font-medium text-maple-700 dark:border-maple-500 dark:bg-maple-600/15 dark:text-maple-400"
                    : "border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800",
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  checked={preferences.theme === theme}
                  onChange={() => save({ theme })}
                  className="sr-only"
                />
                <Icon className="size-4" aria-hidden="true" />
                {theme === "System" ? "Device" : theme}
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-300">Device follows your phone or computer's light or dark setting.</p>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Accent colour</legend>
        <div className="flex flex-wrap gap-3">
          {ACCENTS.map((accent) => (
            <label key={accent} className="flex cursor-pointer flex-col items-center gap-1 text-xs text-stone-600 dark:text-stone-300">
              <input
                type="radio"
                name="accent"
                value={accent}
                checked={preferences.accent === accent}
                onChange={() => save({ accent })}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                style={{ backgroundColor: ACCENT_COLORS[accent] }}
                className={cn(
                  "size-9 rounded-full ring-offset-2 ring-offset-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-stone-500 dark:ring-offset-stone-900",
                  preferences.accent === accent ? "ring-2 ring-stone-900 dark:ring-stone-100" : "",
                )}
              />
              {accent}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Menu text size</legend>
        <div className="grid grid-cols-3 gap-2">
          {MENU_TEXT_SIZES.map((size) => (
            <label
              key={size}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-xl border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-maple-500",
                size === "Small" ? "text-[13px]" : size === "Large" ? "text-[17px]" : "text-[15px]",
                preferences.menuTextSize === size
                  ? "border-maple-600 bg-maple-50 font-medium text-maple-700 dark:border-maple-500 dark:bg-maple-600/15 dark:text-maple-400"
                  : "border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800",
              )}
            >
              <input
                type="radio"
                name="menuTextSize"
                value={size}
                checked={preferences.menuTextSize === size}
                onChange={() => save({ menuTextSize: size })}
                className="sr-only"
              />
              {size}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-300">The size of the items in the side menu.</p>
      </fieldset>

      <div className="mt-5">
        <label htmlFor={`${id}-week`} className="mb-2 block text-sm font-medium">
          Week starts on
        </label>
        <select
          id={`${id}-week`}
          value={preferences.weekStart}
          onChange={(event) => save({ weekStart: event.target.value as WeekStart })}
          className="h-11 w-full max-w-xs rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
        >
          {WEEK_STARTS.map((day) => (
            <option key={day} value={day}>
              {day === "Auto" ? "Automatic (from your language settings)" : day}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-300">For the calendars and the weekly habit chart.</p>
      </div>
    </Section>
  );
}

/** Which tabs and cards the app shows. Turning one off hides it but keeps its notes. */
export function FeaturesSection() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const status = useAuthStatus().data;
  const endToEnd = status?.user?.encryptionMode === "EndToEnd";
  const [confirmPreviews, setConfirmPreviews] = useState(false);

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
        <PreferenceSwitch
          label="Habit tracker"
          description="A Habits tab: tick off your daily habits and see your progress in a chart."
          checked={preferences.habitTracker}
          onChange={(habitTracker) => save({ habitTracker })}
        />
        <PreferenceSwitch
          label="Archive"
          description="An Archive page for notes you put away, and the Archive action on notes and lists. Turning it off hides them; archived notes are kept."
          checked={preferences.archive}
          onChange={(archive) => save({ archive })}
        />
        <PreferenceSwitch
          label="Tags page"
          description="A Tags page listing every tag with how many notes use it. Tags in your notes work either way."
          checked={preferences.tags}
          onChange={(tags) => save({ tags })}
        />
        <PreferenceSwitch
          label="Shrink photos before uploading"
          description="Large photos are resized to 2560 pixels on their longest side and saved as JPEG, often a tenth of the size. Their location and camera details are left out too. Photos already uploaded stay as they are."
          checked={preferences.shrinkPhotos}
          onChange={(shrinkPhotos) => save({ shrinkPhotos })}
        />
        {status?.linkPreviewsAvailable && (
          <PreferenceSwitch
            label="Link previews"
            description={
              <>
                Show the title and description of links in your notes.
                <span className="mt-1 flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Privacy cost: this server visits each linked page, so it learns which links you save
                    {endToEnd ? <strong> — even though your notes are end-to-end encrypted</strong> : null}.
                  </span>
                </span>
              </>
            }
            checked={preferences.linkPreviews}
            // Turning previews on asks first; turning them off is immediate.
            onChange={(linkPreviews) => (linkPreviews ? setConfirmPreviews(true) : save({ linkPreviews: false }))}
          />
        )}
        <ConfirmDialog
          open={confirmPreviews}
          onOpenChange={setConfirmPreviews}
          title="Turn on link previews?"
          description={
            <>
              <p>To show a preview, this server visits every link in the notes you open. That means:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  The server learns the addresses you save.
                  {endToEnd && (
                    <strong> Your notes are end-to-end encrypted, but the links in them would no longer be private from the server.</strong>
                  )}
                </li>
                <li>The sites you link to see a visit from the server, though not from you.</li>
                <li>A link can make the server fetch a page you did not mean to open. The server only visits public web addresses.</li>
              </ul>
              <p className="mt-2">You can turn previews off again at any time.</p>
            </>
          }
          confirmLabel="Turn on"
          onConfirm={() => {
            setConfirmPreviews(false);
            save({ linkPreviews: true });
          }}
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
