import * as Dialog from "@radix-ui/react-dialog";
import { Check, Plus, Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useEnabledKinds } from "../lib/kinds";
import { hasLabelNamed, LABEL_STYLES, labelsOf, MAX_LABEL_NAME } from "../lib/labels";
import { usePreferences } from "../lib/preferences";
import { useInvalidateNotes, useLabels, usePatchNote } from "../lib/queries";
import { Link } from "../lib/router";
import { LABEL_COLORS, type Label, type LabelColor, type Note } from "../lib/types";
import { useToast } from "./Toaster";
import { Button, cn } from "./ui";

/** A small round swatch of a label's colour. */
export function LabelDot({ color, className }: { color: LabelColor; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", LABEL_STYLES[color].dot, className)} />;
}

/** The labels on a note, as coloured chips that list each label's notes; nothing while labels are turned off. */
export function LabelChips({ ids }: { ids?: string[] }) {
  const { labels: enabled } = usePreferences();
  const labels = useLabels(useEnabledKinds(), enabled && (ids?.length ?? 0) > 0);
  const shown = labelsOf(labels.data, ids);
  if (!enabled || shown.length === 0) return null;
  return (
    <ul aria-label="Labels" className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((label) => (
        <li key={label.id}>
          <Link
            href={`/?label=${encodeURIComponent(label.id)}`}
            className={cn(
              "inline-flex h-6 max-w-full items-center rounded-full px-2.5 text-xs font-medium hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500",
              LABEL_STYLES[label.color].chip,
            )}
          >
            <span className="truncate">{label.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The colour a new label gets: the next one in turn, so a few labels made in a row look different. */
export function nextLabelColor(labels: Label[]): LabelColor {
  return LABEL_COLORS[(labels.length % (LABEL_COLORS.length - 1)) + 1]!;
}

/**
 * Chooses the labels of a note: tick them in the list, find one by typing, or create one from what was typed. The
 * note changes when Save is chosen.
 */
export function LabelPicker({ note, open, onOpenChange }: { note: Note; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          // Focus the dialog itself, not the find-or-create field, so opening it does not bring up a phone's keyboard.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(36rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white p-5 shadow-xl outline-none dark:bg-stone-900"
        >
          <Dialog.Title className="text-lg font-semibold">Labels</Dialog.Title>
          {open && <LabelPickerBody note={note} onDone={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LabelPickerBody({ note, onDone }: { note: Note; onDone: () => void }) {
  const labels = useLabels(useEnabledKinds());
  const invalidate = useInvalidateNotes();
  const patch = usePatchNote();
  const toast = useToast();
  const listId = useId();
  const [selected, setSelected] = useState(() => new Set(note.labelIds ?? []));
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const all = labels.data ?? [];
  const typed = filter.trim();
  const shown = typed ? all.filter((label) => label.name.toLocaleLowerCase().includes(typed.toLocaleLowerCase())) : all;
  const canCreate = typed.length > 0 && typed.length <= MAX_LABEL_NAME && !hasLabelNamed(all, typed);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function create(event?: FormEvent) {
    event?.preventDefault();
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const label = await api.labels.create(typed, nextLabelColor(all));
      await invalidate();
      setSelected((current) => new Set(current).add(label.id));
      setFilter("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create the label.");
    } finally {
      setCreating(false);
    }
  }

  function save() {
    const before = new Set(note.labelIds ?? []);
    const unchanged = before.size === selected.size && [...selected].every((id) => before.has(id));
    if (unchanged) {
      onDone();
      return;
    }
    // Keep the order of the label list (by name), and drop IDs of labels deleted meanwhile.
    const labelIds = all.filter((label) => selected.has(label.id)).map((label) => label.id);
    patch.mutate({ id: note.id, labelIds }, { onSuccess: onDone, onError: () => toast.error("The labels could not be saved. Please try again.") });
  }

  return (
    <>
      <form onSubmit={(event) => void create(event)} className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          maxLength={MAX_LABEL_NAME}
          placeholder="Find or create a label"
          aria-label="Find or create a label"
          aria-controls={listId}
          className="h-10 w-full rounded-xl border border-stone-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-950"
        />
      </form>

      <ul id={listId} aria-label="Labels to choose from" className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto">
        {shown.map((label) => {
          const checked = selected.has(label.id);
          return (
            <li key={label.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-stone-100 dark:hover:bg-stone-800">
                <input type="checkbox" checked={checked} onChange={() => toggle(label.id)} className="peer sr-only" />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border peer-focus-visible:outline-2 peer-focus-visible:outline-maple-500",
                    checked ? "border-maple-600 bg-maple-600 text-white" : "border-stone-300 dark:border-stone-600",
                  )}
                >
                  {checked && <Check className="size-3.5" />}
                </span>
                <LabelDot color={label.color} />
                <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
              </label>
            </li>
          );
        })}
        {labels.isPending && <li className="px-2 py-3 text-sm text-stone-500">Loading labels…</li>}
        {labels.data && all.length === 0 && !typed && (
          <li className="px-2 py-3 text-sm text-stone-500 dark:text-stone-400">No labels yet. Type a name above to create one.</li>
        )}
        {typed && shown.length === 0 && !canCreate && (
          <li className="px-2 py-3 text-sm text-stone-500 dark:text-stone-400">No label matches.</li>
        )}
      </ul>

      {canCreate && (
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium text-maple-700 hover:bg-maple-50 disabled:opacity-50 dark:text-maple-400 dark:hover:bg-maple-600/15"
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">Create label “{typed}”</span>
        </button>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </Dialog.Close>
        <Button onClick={save} busy={patch.isPending}>
          Save
        </Button>
      </div>
    </>
  );
}
