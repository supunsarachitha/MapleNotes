import { useRef, type MouseEvent, type TouchEvent } from "react";

/** The most time between the two taps of a double-tap, in milliseconds. */
const DELAY = 350;
/** How far a tap may move, and the second tap may land from the first, in pixels. */
const SLOP = 24;

// Taps on links, checkboxes, buttons and players keep doing what they do. Events from dialogs and menus opened from
// the element reach it too (React passes them through portals), but their targets are not inside it.
function ignored(event: { target: EventTarget; currentTarget: Element }): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return true;
  return target.closest("a, button, input, label, select, textarea, summary, audio, video, [role='button']") !== null;
}

/**
 * Handlers that run `action` when an element is double-tapped on a touch screen or double-clicked, except on the
 * controls inside it. The second tap's touch is cancelled, so the browser does not go on to click whatever has taken
 * the element's place.
 */
export function useDoubleTap(action: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ at: number; x: number; y: number } | null>(null);

  return {
    onDoubleClick(event: MouseEvent<Element>) {
      if (ignored(event)) return;
      window.getSelection()?.removeAllRanges(); // the double-click selected a word
      action();
    },
    onTouchStart(event: TouchEvent<Element>) {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      if (!touch) last.current = null; // two fingers: a pinch, not a tap
    },
    onTouchCancel() {
      start.current = null;
      last.current = null;
    },
    onTouchEnd(event: TouchEvent<Element>) {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch || ignored(event) || Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > SLOP) {
        last.current = null; // a scroll, a swipe or a tap on a control
        return;
      }
      const tap = { at: performance.now(), x: touch.clientX, y: touch.clientY };
      const previous = last.current;
      if (previous && tap.at - previous.at <= DELAY && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= SLOP) {
        last.current = null;
        event.preventDefault();
        action();
      } else {
        last.current = tap;
      }
    },
  };
}
