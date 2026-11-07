import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import { formatAbsolute } from "../lib/format";
import { pushSupport } from "../lib/push";
import { presets, REPEATS, repeatText, useReminder, useSaveReminder } from "../lib/reminders";
import type { ReminderRepeat } from "../lib/types";
import { useToast } from "./Toaster";
import { Button, cn, ErrorMessage } from "./ui";

const field =
  "h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base dark:border-stone-700 dark:bg-stone-950";

/** Sets, changes or removes a note's reminder: quick choices, or a date, time and repeat. */
export function ReminderDialog({ noteId, open, onOpenChange }: { noteId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900">
          {open && <ReminderForm noteId={noteId} onDone={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReminderForm({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const id = useId();
  const toast = useToast();
  const existing = useReminder(noteId);
  const { set, remove } = useSaveReminder(noteId);
  const choices = presets();
  const [date, setDate] = useState(() => (existing?.at ?? choices[0]!.at).slice(0, 10));
  const [time, setTime] = useState(() => (existing?.at ?? choices[0]!.at).slice(11, 16));
  const [repeat, setRepeat] = useState<ReminderRepeat>(existing?.repeat ?? "None");
  const [error, setError] = useState<string | null>(null);

  const save = (at: string) =>
    set.mutate(
      { at, repeat },
      {
        onSuccess: (saved) => {
          toast.info(`Reminder set for ${formatAbsolute(saved.nextAtUtc)}${saved.repeat === "None" ? "" : `, ${repeatText(saved.repeat).toLowerCase()}`}.`);
          onDone();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : "The reminder could not be saved."),
      },
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!date || !time) return setError("Choose a date and a time.");
    save(`${date}T${time}`);
  };

  return (
    <form onSubmit={submit}>
      <Dialog.Title className="text-lg font-semibold">{existing ? "Change reminder" : "Remind me"}</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        {existing
          ? `Next: ${formatAbsolute(existing.nextAtUtc)}${existing.repeat === "None" ? "" : ` · ${repeatText(existing.repeat)}`}`
          : "A notification will remind you of this note."}
      </Dialog.Description>

      <div className="mt-4 flex flex-col gap-2">
        {choices.map((choice) => (
          <Button key={choice.at} type="button" variant="secondary" className="justify-start" disabled={set.isPending} onClick={() => save(choice.at)}>
            {choice.label}
          </Button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <label htmlFor={`${id}-date`} className="text-sm font-medium">
          Date
          <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(field, "mt-1")} />
        </label>
        <label htmlFor={`${id}-time`} className="text-sm font-medium">
          Time
          <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, "mt-1")} />
        </label>
      </div>
      <label htmlFor={`${id}-repeat`} className="mt-3 block text-sm font-medium">
        Repeat
        <select id={`${id}-repeat`} value={repeat} onChange={(e) => setRepeat(e.target.value as ReminderRepeat)} className={cn(field, "mt-1")}>
          {REPEATS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {pushSupport() !== "supported" && (
        <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">
          This device cannot show notifications; reminders still reach your other devices that have them on.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {existing && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  toast.info("Reminder removed.");
                  onDone();
                },
                onError: () => setError("The reminder could not be removed."),
              })
            }
          >
            Remove
          </Button>
        )}
        <Dialog.Close asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" busy={set.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
