import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "../lib/api";
import { focusAtEndRef } from "../lib/focus";
import { useEnabledKinds } from "../lib/kinds";
import { hasLabelNamed, LABEL_STYLES, MAX_LABEL_NAME, nextLabelColor } from "../lib/labels";
import { usePreferences } from "../lib/preferences";
import { useAuthStatus, useInvalidateNotes, useLabels } from "../lib/queries";
import { Link } from "../lib/router";
import { LABEL_COLORS, type Label, type LabelColor } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { LabelDot } from "./Labels";
import { PreferenceSwitch, useSavePreferences } from "./PreferenceSections";
import { useToast } from "./Toaster";
import { Button, IconButton, Section, cn } from "./ui";

/** A swatch button that opens the label colours to choose from. */
function ColorPicker({ color, label, onChange }: { color: LabelColor; label: string; onChange: (color: LabelColor) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${color}`}
          title={`${label}: ${color}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-maple-500 dark:hover:bg-stone-800"
        >
          <LabelDot color={color} className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 grid grid-cols-5 gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          <DropdownMenu.RadioGroup value={color} onValueChange={(value) => onChange(value as LabelColor)}>
            {LABEL_COLORS.map((option) => (
              <DropdownMenu.RadioItem
                key={option}
                value={option}
                aria-label={option}
                title={option}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full outline-none data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800"
              >
                <span className={cn("flex size-6 items-center justify-center rounded-full text-white", LABEL_STYLES[option].dot)}>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-3.5" strokeWidth={3} />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Runs a label change, refreshing labels and notes after it and telling the user when it failed. */
function useLabelChange() {
  const invalidate = useInvalidateNotes();
  const toast = useToast();
  return async (change: () => Promise<unknown>, failed: string): Promise<boolean> => {
    try {
      await change();
      await invalidate();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : failed);
      return false;
    }
  };
}

function LabelRow({ label, labels }: { label: Label; labels: Label[] }) {
  const run = useLabelChange();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label.name);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function rename() {
    const name = draft.trim();
    setRenaming(false);
    if (!name || name === label.name) return;
    if (hasLabelNamed(labels, name, label.id)) {
      toast.error(`You already have a label called “${name}”.`);
      return;
    }
    await run(() => api.labels.update(label.id, { name }), "Could not rename the label.");
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void rename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenaming(false);
    }
  }

  return (
    <li className="flex min-h-12 items-center gap-2 py-1.5">
      <ColorPicker color={label.color} label={`Colour of ${label.name}`} onChange={(color) => void run(() => api.labels.update(label.id, { color }), "Could not change the colour.")} />
      {renaming ? (
        <input
          ref={focusAtEndRef}
          aria-label={`New name for ${label.name}`}
          value={draft}
          maxLength={MAX_LABEL_NAME}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={onKey}
          className="h-9 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 text-sm outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950"
        />
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label.name}</span>
          {label.hideNotes && <span className="block text-xs text-stone-500 dark:text-stone-400">Notes hidden</span>}
        </span>
      )}
      <Link
        href={`/?label=${encodeURIComponent(label.id)}`}
        className="shrink-0 rounded-full px-2 py-1 text-xs tabular-nums text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      >
        {label.noteCount === 1 ? "1 note" : `${label.noteCount} notes`}
      </Link>
      <IconButton
        label={label.hideNotes ? `Show notes labelled ${label.name} on Home and in Quick notes` : `Hide notes labelled ${label.name} from Home and Quick notes`}
        aria-pressed={label.hideNotes === true}
        className={cn("size-9", label.hideNotes && "text-maple-700 dark:text-maple-400")}
        onClick={() => void run(() => api.labels.update(label.id, { hideNotes: !label.hideNotes }), "Could not change where the label's notes show.")}
      >
        {label.hideNotes ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
      <IconButton
        label={`Rename ${label.name}`}
        className="size-9"
        onClick={() => {
          setDraft(label.name);
          setRenaming(true);
        }}
      >
        <Pencil className="size-4" />
      </IconButton>
      <IconButton label={`Delete ${label.name}`} className="size-9" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" />
      </IconButton>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete the label “${label.name}”?`}
        description={
          label.noteCount > 0
            ? `It comes off its ${label.noteCount === 1 ? "note" : `${label.noteCount} notes`}. The notes themselves stay as they are.`
            : "No note has it. Nothing else changes."
        }
        confirmLabel="Delete label"
        busy={deleting}
        onConfirm={async () => {
          setDeleting(true);
          if (await run(() => api.labels.remove(label.id), "Could not delete the label.")) {
            setConfirming(false);
            toast.info(`Label “${label.name}” deleted.`);
          }
          setDeleting(false);
        }}
      />
    </li>
  );
}

function NewLabel({ labels }: { labels: Label[] }) {
  const run = useLabelChange();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor | null>(null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const chosen = color ?? nextLabelColor(labels);

  async function create(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (hasLabelNamed(labels, clean)) {
      setError(`You already have a label called “${clean}”.`);
      return;
    }
    setSaving(true);
    if (await run(() => api.labels.create(clean, chosen), "Could not create the label.")) {
      setName("");
      setColor(null);
      setError(undefined);
    }
    setSaving(false);
  }

  return (
    <form onSubmit={(event) => void create(event)}>
      <div className="flex items-center gap-2">
        <ColorPicker color={chosen} label="Colour of the new label" onChange={setColor} />
        <input
          value={name}
          maxLength={MAX_LABEL_NAME}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          placeholder="New label, e.g. Work"
          aria-label="New label name"
          aria-invalid={error ? true : undefined}
          className="h-10 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 text-sm outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950"
        />
        <Button type="submit" busy={saving} disabled={!name.trim()} className="h-10">
          <Plus className="size-4" aria-hidden="true" /> Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

/** Settings → Labels: turning labels on or off, and the account's labels to create, rename, recolour or delete. */
export function LabelSettings() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const labels = useLabels(useEnabledKinds());
  const endToEnd = useAuthStatus().data?.user?.encryptionMode === "EndToEnd";
  const all = labels.data ?? [];

  return (
    <>
      <Section title="Labels">
        <PreferenceSwitch
          label="Use labels"
          description="Put coloured labels on notes and todo lists from their ⋯ menu, and find a label's notes in the side menu. Turning labels off hides them; nothing is deleted."
          checked={preferences.labels}
          onChange={(on) => save({ labels: on })}
        />
      </Section>
      <Section
        title="Your labels"
        description={
          <>
            Unlike #tags, which come from what you write, labels are put on by hand, so they never change a note's text.
            {endToEnd && " Their names are end-to-end encrypted like your notes; their colours, and which notes carry them, are not."}
          </>
        }
      >
        <NewLabel labels={all} />
        {labels.isPending ? (
          <p className="mt-4 text-sm text-stone-500">Loading labels…</p>
        ) : all.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">No labels yet.</p>
        ) : (
          <ul aria-label="Your labels" className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
            {all.map((label) => (
              <LabelRow key={label.id} label={label} labels={all} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          The eye hides a label's notes from Home and Quick notes; they stay on the label's page, and come back when the
          label is taken off or the eye is turned off. Up to 100 labels, 40 characters each, and 20 on a note. Exports keep
          each note's labels, and restoring one brings them back.
        </p>
      </Section>
    </>
  );
}
