import { describe, expect, it } from "vitest";
import { fitMenuToViewport } from "./fit-menu";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 300 };

describe("fitMenuToViewport", () => {
  it("opens at the cursor when it fits", () => {
    expect(fitMenuToViewport({ x: 100, y: 100 }, size, viewport)).toMatchObject({
      left: 100,
      top: 100,
    });
  });

  it("opens upward near the bottom edge and leftward near the right edge", () => {
    expect(fitMenuToViewport({ x: 900, y: 700 }, size, viewport)).toMatchObject({
      left: 700,
      top: 400,
    });
  });

  it("taller than the window: pinned to the top, capped so it scrolls", () => {
    const fit = fitMenuToViewport({ x: 10, y: 500 }, { width: 200, height: 2000 }, viewport);
    expect(fit).toEqual({ left: 10, top: 4, maxHeight: 792 });
  });
});
