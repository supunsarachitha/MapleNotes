import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  NO_ZOOM,
  clampZoom,
  distance,
  midpoint,
  zoomAround,
} from "./zoom";

const frame = { width: 400, height: 800 };
const image = { width: 400, height: 300 }; // a landscape photo fitted to a phone's width

describe("clampZoom", () => {
  it("keeps the scale between normal size and the maximum", () => {
    expect(clampZoom({ scale: 0.5, x: 0, y: 0 }, image, frame).scale).toBe(1);
    expect(clampZoom({ scale: 9, x: 0, y: 0 }, image, frame).scale).toBe(
      MAX_SCALE,
    );
  });

  it("centres an image that fits and stops a zoomed one's edges at the frame", () => {
    expect(clampZoom({ scale: 1, x: 50, y: -50 }, image, frame)).toEqual(
      NO_ZOOM,
    );
    // At 2x the photo is 800 x 600: it can move 200 px sideways but not up or down, as it is still shorter than 800.
    expect(clampZoom({ scale: 2, x: 500, y: 500 }, image, frame)).toEqual({
      scale: 2,
      x: 200,
      y: 0,
    });
    expect(clampZoom({ scale: 4, x: -900, y: -900 }, image, frame)).toEqual({
      scale: 4,
      x: -600,
      y: -200,
    });
  });
});

describe("zoomAround", () => {
  it("keeps the tapped point under the finger", () => {
    const zoomed = zoomAround(NO_ZOOM, 2, { x: 100, y: 50 });
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -50 });
    // The image point that was at (100, 50) is still drawn there: (point - offset) / scale.
    expect((100 - zoomed.x) / zoomed.scale).toBe(100);
  });

  it("follows a pinch's midpoint as it moves", () => {
    const start = { scale: 2, x: -100, y: 0 };
    const next = zoomAround(start, 3, { x: 0, y: 0 }, { x: 30, y: 10 });
    // The image point under the old midpoint was ((0 + 100) / 2, 0) = (50, 0); now it sits under (30, 10).
    expect(next).toEqual({ scale: 3, x: 30 - 50 * 3, y: 10 });
  });
});

it("measures fingers", () => {
  expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  expect(midpoint({ x: -10, y: 0 }, { x: 30, y: 20 })).toEqual({
    x: 10,
    y: 10,
  });
});
