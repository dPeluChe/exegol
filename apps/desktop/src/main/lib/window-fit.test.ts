import { describe, expect, it } from "vitest";
import { fitSavedWindow } from "./window-fit";

const LAPTOP = { x: 0, y: 0, width: 2056, height: 1329 };
const ABOVE = { x: -412, y: -1440, width: 2560, height: 1440 };
const RIGHT = { x: 2148, y: -702, width: 2560, height: 1440 };
const DISPLAYS = [LAPTOP, RIGHT, ABOVE];

describe("fitSavedWindow", () => {
  it("moves a window that hangs off its display back onto it, and keeps the rest", () => {
    const saved = { x: -535, y: -1410, width: 2056, height: 1285, isMaximized: true };
    expect(fitSavedWindow(saved, DISPLAYS)).toEqual({
      ...saved,
      x: -412,
      displayBounds: ABOVE,
    });
  });

  it("leaves a window that already fits to the library", () => {
    expect(fitSavedWindow({ x: 10, y: 10, width: 800, height: 600 }, DISPLAYS)).toBeNull();
  });

  it("picks the display that shows most of a window across two", () => {
    const fitted = fitSavedWindow({ x: 1900, y: 100, width: 300, height: 400 }, [LAPTOP, RIGHT]);
    expect(fitted).toMatchObject({ x: 1756, y: 100, displayBounds: LAPTOP });
  });

  it("shrinks a window bigger than the display it lands on", () => {
    const fitted = fitSavedWindow({ x: -10, y: 0, width: 3000, height: 1300 }, [LAPTOP]);
    expect(fitted).toMatchObject({ x: 0, width: 2056, displayBounds: LAPTOP });
  });

  it("gives up on a window on a display that is gone, or barely showing", () => {
    expect(fitSavedWindow({ x: 9000, y: 0, width: 800, height: 600 }, [LAPTOP])).toBeNull();
    expect(fitSavedWindow({ x: 2030, y: 0, width: 800, height: 600 }, [LAPTOP])).toBeNull();
  });
});
