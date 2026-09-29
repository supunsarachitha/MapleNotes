// .NET-compatible text rules for the browser export, so that its archives match the server's byte for byte (see
// export-vectors.json). Each helper names the .NET API it mirrors; the differences from JavaScript's built-ins are
// deliberate.

/** char.IsWhiteSpace, for one UTF-16 unit (includes U+0085, excludes U+FEFF, unlike JavaScript's \s). */
export function isWhiteSpace(unit: string): boolean {
  return /^[\t\n\v\f\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(unit);
}

/** string.Trim() */
export function trim(text: string): string {
  return trimEnd(trimStart(text));
}

/** string.TrimStart() */
export function trimStart(text: string): string {
  let start = 0;
  while (start < text.length && isWhiteSpace(text[start]!)) start++;
  return text.slice(start);
}

/** string.TrimEnd() */
export function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && isWhiteSpace(text[end - 1]!)) end--;
  return text.slice(0, end);
}

/** string.Trim(params char[] trimChars) */
export function trimChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start]!)) start++;
  while (end > start && chars.includes(text[end - 1]!)) end--;
  return text.slice(start, end);
}

/** char.IsControl, for one UTF-16 unit. */
export function isControl(unit: string): boolean {
  return /^[\x00-\x1f\x7f-\x9f]$/.test(unit);
}

/**
 * Rune.IsLetterOrDigit (letters and decimal digits only, not other numbers such as ² or Ⅻ). For a lone surrogate, as
 * char.IsLetterOrDigit sees it, the answer is false.
 */
export function isLetterOrDigit(codePoint: string): boolean {
  return /^[\p{L}\p{Nd}]$/u.test(codePoint);
}

/**
 * Rune.ToLowerInvariant: simple case mapping. JavaScript lower-cases single code points the same way except U+0130
 * (İ), which it expands to two code points and .NET leaves unchanged.
 */
export function lowerInvariant(codePoint: string): string {
  if (codePoint === "\u0130") return codePoint;
  const lower = codePoint.toLowerCase();
  return [...lower].length === 1 ? lower : codePoint;
}

/** The comparison key of StringComparer.OrdinalIgnoreCase (per-character invariant upper case). */
export function ignoreCaseKey(text: string): string {
  return Array.from(text, (ch) => {
    const upper = ch.toUpperCase();
    return [...upper].length === 1 ? upper : ch;
  }).join("");
}

/** Path.GetExtension on Linux: from the last dot of the last path segment, or "" (also for a trailing dot). */
export function getExtension(path: string): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const ch = path[i];
    if (ch === ".") return i === path.length - 1 ? "" : path.slice(i);
    if (ch === "/") break;
  }
  return "";
}

/** Uri.EscapeDataString: RFC 3986, so also !'()* (which encodeURIComponent keeps) are escaped. */
export function escapeDataString(text: string): string {
  const wellFormed = text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  return encodeURIComponent(wellFormed).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const hex = (unit: number) => `\\u${unit.toString(16).toUpperCase().padStart(4, "0")}`;
const SHORT_ESCAPES: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

// What System.Text.Json escapes with JavaScriptEncoder.UnsafeRelaxedJsonEscaping: controls, surrogates, private use,
// unassigned code points, line and paragraph separators, spaces other than U+0020, U+FEFF, and every character outside
// the Basic Multilingual Plane (as a surrogate pair). HTML-sensitive characters and other text stay as they are.
const JSON_ESCAPED = /["\\\p{Cc}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}\ufeff\u{10000}-\u{10ffff}]/gu;

/** A JSON string literal, escaped as System.Text.Json does with its relaxed encoder. */
export function jsonString(text: string): string {
  return `"${text.replace(JSON_ESCAPED, (ch) => {
    if (ch === " ") return ch;
    const short = SHORT_ESCAPES[ch];
    if (short) return short;
    const codePoint = ch.codePointAt(0)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return hex(0xfffd); // a lone surrogate
    return ch.length === 2 ? hex(ch.charCodeAt(0)) + hex(ch.charCodeAt(1)) : hex(codePoint);
  })}"`;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JsonSerializer.Serialize with WriteIndented: two-space indentation, properties in insertion order. */
export function serializeJson(value: JsonValue, indent = ""): string {
  if (value === null) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value !== "object") return String(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[\n${value.map((item) => inner + serializeJson(item, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  return entries.length === 0
    ? "{}"
    : `{\n${entries.map(([key, item]) => `${inner}${jsonString(key)}: ${serializeJson(item, inner)}`).join(",\n")}\n${indent}}`;
}
