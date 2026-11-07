import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toZone } from "../export/zone";
import { api } from "./api";
import { currentTimeZone } from "./dates";
import { queryKeys } from "./queries";
import type { Reminder, ReminderRepeat } from "./types";

/** The account's reminders (on notes that are neither archived nor in the trash), soonest first. */
export function useReminders() {
  return useQuery({ queryKey: queryKeys.reminders, queryFn: api.reminders.list, staleTime: 60_000 });
}

/** One note's reminder, from the account's list. */
export function useReminder(noteId: string): Reminder | undefined {
  return useReminders().data?.find((reminder) => reminder.noteId === noteId);
}

/** Sets or removes a note's reminder, then reloads the list. */
export function useSaveReminder(noteId: string) {
  const client = useQueryClient();
  const done = () => void client.invalidateQueries({ queryKey: queryKeys.reminders });
  return {
    set: useMutation({
      mutationFn: ({ at, repeat }: { at: string; repeat: ReminderRepeat }) => api.reminders.set(noteId, at, currentTimeZone(), repeat),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: () => api.reminders.remove(noteId), onSuccess: done }),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local date and time as the API takes it: `yyyy-MM-ddTHH:mm`. */
export const localStamp = (y: number, m: number, d: number, hh: number, mm: number) => {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm)); // normalises day/month overflow
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/** Quick choices, in the chosen time zone: later today (in 3 hours, on the hour), tomorrow at 9, next Monday at 9. */
export function presets(now = new Date(), zone = currentTimeZone()): Array<{ label: string; at: string }> {
  const t = toZone(now, zone);
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay();
  const list: Array<{ label: string; at: string }> = [];
  if (t.hour + 3 <= 21) list.push({ label: `Later today, ${pad(t.hour + 3)}:00`, at: localStamp(t.year, t.month, t.day, t.hour + 3, 0) });
  list.push({ label: "Tomorrow, 09:00", at: localStamp(t.year, t.month, t.day + 1, 9, 0) });
  list.push({ label: "Next Monday, 09:00", at: localStamp(t.year, t.month, t.day + (((8 - weekday) % 7) || 7), 9, 0) });
  return list;
}

/** "Every day", "Every week", "Every month", or "" for once. */
export const repeatText = (repeat: ReminderRepeat) =>
  repeat === "Daily" ? "Every day" : repeat === "Weekly" ? "Every week" : repeat === "Monthly" ? "Every month" : "";

export const REPEATS: Array<{ value: ReminderRepeat; label: string }> = [
  { value: "None", label: "Once" },
  { value: "Daily", label: "Every day" },
  { value: "Weekly", label: "Every week" },
  { value: "Monthly", label: "Every month" },
];
