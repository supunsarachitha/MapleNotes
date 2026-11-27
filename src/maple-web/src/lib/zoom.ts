/** Pinch and double-tap zoom maths for the image viewer. Points are measured from the centre of the frame. */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
/** The image's transform: `translate(x, y) scale(scale)` around the frame's centre. */
export type Zoom = { scale: number; x: number; y: number };

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };
/** The furthest a pinch can zoom in. */
export const MAX_SCALE = 4;
/** How far a double-tap zooms in. */
export const TAP_SCALE = 2.5;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value)) || 0;

/** Keeps the scale between 1 and {@link MAX_SCALE} and stops the image's edges from moving inside the frame. */
export function clampZoom(zoom: Zoom, image: Size, frame: Size): Zoom {
  const scale = clamp(zoom.scale, 1, MAX_SCALE);
  const limitX = Math.max(0, (image.width * scale - frame.width) / 2);
  const limitY = Math.max(0, (image.height * scale - frame.height) / 2);
  return {
    scale,
    x: clamp(zoom.x, -limitX, limitX),
    y: clamp(zoom.y, -limitY, limitY),
  };
}

/**
 * Zooms from `start` to `scale` so the part of the image that was under `anchor` ends up under `to` (by default
 * the same place): the pinch's midpoint, or the double-tapped point.
 */
export function zoomAround(
  start: Zoom,
  scale: number,
  anchor: Point,
  to: Point = anchor,
): Zoom {
  const imageX = (anchor.x - start.x) / start.scale;
  const imageY = (anchor.y - start.y) / start.scale;
  return { scale, x: to.x - imageX * scale, y: to.y - imageY * scale };
}

export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
