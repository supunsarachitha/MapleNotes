import {
  escapeDataString,
  getExtension,
  ignoreCaseKey,
  isControl,
  isLetterOrDigit,
  isWhiteSpace,
  lowerInvariant,
  trim,
  trimChars,
} from "./dotnet";
import { dateOnly, type ZonedTime } from "./zone";

// File and folder names inside an export, identical to the server's (Features/Export/ExportNaming.cs): safe on
// Windows, macOS and Linux, bounded in length, and unique within the archive ignoring case.

export type ExportLayout = "flat" | "year" | "month" | "day";

const MAX_SLUG_LENGTH = 60;
const MAX_ATTACHMENT_NAME_LENGTH = 100;

const RESERVED_WINDOWS_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// .NET's \s and \d (Unicode, without RegexOptions.ECMAScript).
const S = "[\\f\\n\\r\\t\\v\\x85\\p{Z}]";
/** Heading markers, quote markers, list bullets and task boxes at the start of a line. */
const LINE_MARKERS = new RegExp(`^(?:#{1,6}${S}+|>${S}*|[-*+]${S}+(?:\\[[ xX]\\]${S}+)?|\\p{Nd}+[.)]${S}+)+`, "u");
/** #tags, as recognized by the note tag parser. */
const TAGS = /(?<![\p{L}\p{N}_/#&])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu;

/**
 * The first line of a note as a short, lower-case slug ("Buy **maple** syrup! #shopping" becomes "buy-maple-syrup").
 * Letters in any script are kept; #tags are left out unless the line has nothing else.
 */
export function slug(markdown: string): string {
  let firstLine = markdown.split("\n").map(trim).find((line) => line.length > 0) ?? "";
  firstLine = firstLine.replace(LINE_MARKERS, "");
  const withoutTags = firstLine.replace(TAGS, " ");
  if ([...withoutTags.split("")].some(isLetterOrDigit)) firstLine = withoutTags; // per UTF-16 unit, like char.IsLetterOrDigit

  let result = "";
  let pendingDash = false;
  for (const rune of firstLine) {
    if (isLetterOrDigit(rune)) {
      const letter = lowerInvariant(rune);
      const dash = pendingDash && result.length > 0;
      if (result.length + letter.length + (dash ? 1 : 0) > MAX_SLUG_LENGTH) break; // never cut a character in half
      if (dash) result += "-";
      pendingDash = false;
      result += letter;
    } else if (rune !== "'" && rune !== "\u2019") {
      pendingDash = true; // any other character separates words
    }
  }

  result = trimChars(result, "-");
  return result.length === 0 ? "note" : result;
}

/** An uploaded file name made safe to write into an archive, keeping its extension. */
export function safeFileName(fileName: string): string {
  let cleaned = "";
  for (const unit of fileName.split("")) {
    cleaned += isControl(unit) || isWhiteSpace(unit) || '\\/:*?"<>|'.includes(unit) ? "-" : unit;
  }

  let name = trimChars(cleaned.replace(/-{2,}/g, "-"), ". -");
  if (name.length === 0) name = "file";

  let extension = getExtension(name);
  let stem = name.slice(0, name.length - extension.length);
  if (stem.length === 0 || RESERVED_WINDOWS_NAMES.has(ignoreCaseKey(stem))) stem = `_${stem}`;
  if (extension.length > 20) extension = "";
  if (stem.length + extension.length > MAX_ATTACHMENT_NAME_LENGTH) stem = stem.slice(0, MAX_ATTACHMENT_NAME_LENGTH - extension.length);
  return stem + extension;
}

/** The folder (no trailing slash) for a note created at `created`; empty for the flat layout. */
export function folder(layout: ExportLayout, created: ZonedTime): string {
  const date = dateOnly(created);
  return layout === "year" ? date.slice(0, 4) : layout === "month" ? date.slice(0, 7) : layout === "day" ? date : "";
}

/** `path`, or the first free variant with -2, -3… before the extension; records it as used (ignoring case). */
export function unique(path: string, used: Set<string>): string {
  const extension = getExtension(path);
  const stem = path.slice(0, path.length - extension.length);
  let candidate = path;
  for (let n = 2; used.has(ignoreCaseKey(candidate)); n++) candidate = `${stem}-${n}${extension}`;
  used.add(ignoreCaseKey(candidate));
  return candidate;
}

/** The path from the folder of `fromFile` to `toPath`, e.g. ../attachments/x.png. */
export function relativePath(fromFile: string, toPath: string): string {
  return "../".repeat(fromFile.split("/").length - 1) + toPath;
}

/** A relative path percent-encoded for a Markdown link, keeping the slashes. */
export function linkTarget(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment === ".." ? segment : escapeDataString(segment)))
    .join("/");
}
