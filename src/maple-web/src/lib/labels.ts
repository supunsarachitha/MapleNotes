import { LABEL_COLORS, type Label, type LabelColor } from "./types";

// The shades of each label colour, written out in full so that Tailwind finds every class.

interface LabelStyle {
  /** A small round swatch. */
  dot: string;
  /** A chip: background and text, light and dark. */
  chip: string;
}

export const LABEL_STYLES: Record<LabelColor, LabelStyle> = {
  Grey: { dot: "bg-stone-500", chip: "bg-stone-200 text-stone-800 dark:bg-stone-700/60 dark:text-stone-200" },
  Red: { dot: "bg-red-500", chip: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300" },
  Orange: { dot: "bg-orange-500", chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300" },
  Amber: { dot: "bg-amber-500", chip: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300" },
  Green: { dot: "bg-green-600", chip: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300" },
  Teal: { dot: "bg-teal-600", chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300" },
  Blue: { dot: "bg-blue-600", chip: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300" },
  Indigo: { dot: "bg-indigo-600", chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300" },
  Purple: { dot: "bg-purple-600", chip: "bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300" },
  Pink: { dot: "bg-pink-500", chip: "bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300" },
};

/** The most characters in a label's name (the server checks the same). */
export const MAX_LABEL_NAME = 40;

/** The labels with these IDs, in the order of `labels` (by name); IDs of deleted labels are skipped. */
export function labelsOf(labels: Label[] | undefined, ids: string[] | undefined): Label[] {
  if (!labels || !ids || ids.length === 0) return [];
  const wanted = new Set(ids);
  return labels.filter((label) => wanted.has(label.id));
}

/** The colour a new label gets: the next one in turn, so a few labels made in a row look different. */
export function nextLabelColor(labels: Label[]): LabelColor {
  return LABEL_COLORS[(labels.length % (LABEL_COLORS.length - 1)) + 1]!;
}

/** Whether a label of this name exists already, ignoring case and surrounding spaces. */
export function hasLabelNamed(labels: Label[], name: string, except?: string): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  return labels.some((label) => label.id !== except && label.name.toLocaleLowerCase() === wanted);
}
