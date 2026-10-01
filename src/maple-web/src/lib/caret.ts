// Where the caret of a text box is on screen, for placing a popup next to it. A hidden copy of the text box, with the
// same font, padding and wrapping, holds the text up to the caret followed by a marker; the marker's position is the
// caret's. (Text boxes have no API for this.)

const COPIED = [
  "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "paddingTop",
  "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
  "lineHeight", "textTransform", "wordSpacing", "tabSize", "textIndent",
] as const;

/** The caret's position inside the text box, in pixels from its top left corner, and the height of a line. */
export function caretPosition(textarea: HTMLTextAreaElement, offset: number): { top: number; left: number; height: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of COPIED) mirror.style[property] = style[property];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 24;
  const position = { top: marker.offsetTop - textarea.scrollTop, left: marker.offsetLeft - textarea.scrollLeft, height: lineHeight };
  mirror.remove();
  return position;
}
