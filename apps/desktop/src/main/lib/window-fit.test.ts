import { describe, expect, it } from "vitest";
import { fitSavedWindow } from "./window-fit";

const LAPTOP = { x: 0, y: 0, width: 2056, height: 1329 };
const ABOVE = { x: -412, y: -1440, width: 2560, height: 1440 };
const RIGHT = { x: 2148, y: -702, width: 2560, height: 1440 };
const DISPLAYS = [LAPTOP, RIGHT, ABOVE];

describe("fitSavedWindow", () => {
  it("moves a window that hangs off its display back onto it, and keeps the rest", () => {
    const saved = { x: -535, y: -1410, width: 2056, height: 1285, isMaximized: true };
    expect(fitSavedWindow(saved, DISPLAYS, LAPTOP)).toEqual({ ...saved, x: -412 });
  });

  it("leaves a window that already fits", () => {
    expect(fitSavedWindow({ x: 10, y: 10, width: 800, height: 600 }, DISPLAYS, LAPTOP)).toBeNull();
  });

  it("picks the display that shows most of a window across two", () => {
    const fitted = fitSavedWindow({ x: 1900, y: 100, width: 300, height: 400 }, DISPLAYS, RIGHT);
    expect(fitted).toMatchObject({ x: 1756, y: 100 });
  });

  it("shrinks a window bigger than the display it lands on", () => {
    const fitted = fitSavedWindow({ x: -10, y: 0, width: 3000, height: 1300 }, [LAPTOP], LAPTOP);
    expect(fitted).toMatchObject({ x: 0, width: 2056 });
  });

  it("brings a window from a display that is gone to the primary one, still maximized", () => {
    const saved = { x: 9000, y: 0, width: 800, height: 600, isMaximized: true };
    expect(fitSavedWindow(saved, [LAPTOP], LAPTOP)).toEqual({ ...saved, x: 1256 });
  });

  it("treats a window barely showing like one on a display that is gone", () => {
    const fitted = fitSavedWindow({ x: 2030, y: 0, width: 800, height: 600 }, [LAPTOP], LAPTOP);
    expect(fitted).toMatchObject({ x: 1256 });
  });
});
