import { describe, expect, it } from "vitest";
import {
  clampToScreen,
  containRect,
  deviceScale,
  isTap,
  orientPoints,
  pointsFromFrame,
  swipeSeconds,
  toDevicePoint,
} from "./simulator-geometry";

// iPhone 17 Pro: 402x874 pt, streamed at scale 0.5 of 3x = 603x1311 px
const FRAME = { width: 603, height: 1311 };
const POINTS = { width: 402, height: 874 };

describe("containRect", () => {
  it("letterboxes a tall frame in a wide box", () => {
    const box = { left: 100, top: 50, width: 1000, height: 1311 / 2 };
    const drawn = containRect(box, FRAME);
    expect(drawn.height).toBeCloseTo(655.5);
    expect(drawn.width).toBeCloseTo(301.5);
    expect(drawn.left).toBeCloseTo(100 + (1000 - 301.5) / 2);
    expect(drawn.top).toBeCloseTo(50);
  });
});

describe("toDevicePoint", () => {
  const box = { left: 0, top: 0, width: 603, height: 1311 };

  it("maps the frame's corners and centre to points", () => {
    expect(toDevicePoint({ x: 0, y: 0 }, box, FRAME, POINTS)).toEqual({ x: 0, y: 0 });
    expect(toDevicePoint({ x: 603, y: 1311 }, box, FRAME, POINTS)).toEqual({ x: 402, y: 874 });
    const centre = toDevicePoint({ x: 301.5, y: 655.5 }, box, FRAME, POINTS);
    expect(centre?.x).toBeCloseTo(201);
    expect(centre?.y).toBeCloseTo(437);
  });

  it("maps through the letterbox of a wider pane", () => {
    const wide = { left: 20, top: 10, width: 800, height: 437 };
    // drawn: 201 x 437 at left 20 + (800 - 201) / 2
    const drawnLeft = 20 + (800 - 201) / 2;
    const at = toDevicePoint({ x: drawnLeft + 100.5, y: 10 + 218.5 }, wide, FRAME, POINTS);
    expect(at?.x).toBeCloseTo(201);
    expect(at?.y).toBeCloseTo(437);
  });

  it("is null in the letterbox bars", () => {
    const wide = { left: 0, top: 0, width: 800, height: 437 };
    expect(toDevicePoint({ x: 5, y: 200 }, wide, FRAME, POINTS)).toBeNull();
  });

  it("clamps a swipe end past the edge back onto the screen", () => {
    const end = clampToScreen({ x: 900, y: -40 }, box, FRAME);
    expect(end).toEqual({ x: 603, y: 0 });
    expect(toDevicePoint(end, box, FRAME, POINTS)).toEqual({ x: 402, y: 0 });
  });
});

describe("pointsFromFrame", () => {
  it("recovers the points from a 0.5-scale stream of a 3x device", () => {
    expect(pointsFromFrame(FRAME, 0.5, 3)).toEqual(POINTS);
  });

  it("knows the 2x devices", () => {
    expect(deviceScale("iPhone 17 Pro")).toBe(3);
    expect(deviceScale("iPhone 16e")).toBe(3);
    expect(deviceScale("iPhone 11 Pro Max")).toBe(3);
    expect(deviceScale("iPhone 11")).toBe(2);
    expect(deviceScale("iPhone SE (3rd generation)")).toBe(2);
    expect(deviceScale("iPad Air 11-inch (M3)")).toBe(2);
    // iPad Air 11": 820x1180 pt at 2x, streamed at 0.5
    expect(pointsFromFrame({ width: 820, height: 1180 }, 0.5, 2)).toEqual({
      width: 820,
      height: 1180,
    });
  });
});

describe("orientPoints", () => {
  it("swaps the axes when the frame is landscape", () => {
    expect(orientPoints(POINTS, { width: 1311, height: 603 })).toEqual({ width: 874, height: 402 });
    expect(orientPoints(POINTS, FRAME)).toEqual(POINTS);
    expect(orientPoints(POINTS, { width: 0, height: 0 })).toEqual(POINTS);
  });
});

describe("gestures", () => {
  it("tells a tap from a swipe", () => {
    expect(isTap({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true);
    expect(isTap({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(false);
  });

  it("keeps swipe durations in AXe's range", () => {
    expect(swipeSeconds(20)).toBe(0.1);
    expect(swipeSeconds(400)).toBe(0.4);
    expect(swipeSeconds(9000)).toBe(1.5);
  });
});
