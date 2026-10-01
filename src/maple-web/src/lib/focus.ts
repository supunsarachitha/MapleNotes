/**
 * Focuses a text field with the caret after its last character, and scrolls a text box to show it there. Browsers put
 * the caret at the start when a field with text gets focus, which is the wrong place to carry on writing.
 */
export function focusAtEnd(element: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!element) return;
  element.focus({ preventScroll: true });
  const end = element.value.length;
  element.setSelectionRange(end, end);
  if (element instanceof HTMLTextAreaElement) element.scrollTop = element.scrollHeight;
  element.scrollIntoView?.({ block: "nearest" });
}

/**
 * A ref for a field that should take focus with the caret at its end as soon as it appears. Module-level, so React
 * calls it once when the field mounts rather than on every render.
 */
export function focusAtEndRef(element: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (element) focusAtEnd(element);
}
