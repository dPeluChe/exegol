import { describe, expect, it } from "vitest";
import { computeFit } from "./terminal-fit";

const CELL = { width: 10, height: 20 };

describe("computeFit", () => {
  // A shell scrolls, so leftover pixels are a margin. Rounding UP would give the
  // shell a row it cannot fully paint.
  it("floors for a shell and leaves the cell alone", () => {
    expect(computeFit({ width: 105, height: 210 }, CELL, "normal")).toEqual({
      cols: 10,
      rows: 10,
      letterSpacing: 1,
      lineHeight: 1,
    });
  });

  // A TUI paints exactly rows × cols and does not scroll, so the same flooring
  // leaves a dead strip along the bottom and right of the pane.
  it("ceils for a TUI so the grid covers the host", () => {
    const fit = computeFit({ width: 105, height: 210 }, CELL, "alternate");
    expect(fit).toMatchObject({ cols: 11, rows: 11 });
  });

  it("stretches the cell to close the remaining gap, never past the cap", () => {
    // 105px over 11 cols = 9.55px available per 10px cell → ratio < 1, no stretch.
    expect(computeFit({ width: 105, height: 210 }, CELL, "alternate")?.letterSpacing).toBe(1);
    // A host far larger than its grid stretches, but only to the distortion cap.
    const wide = computeFit({ width: 400, height: 210 }, { width: 100, height: 20 }, "alternate");
    expect(wide?.cols).toBe(4);
    expect(wide?.letterSpacing).toBe(1);
  });

  it("never returns fewer than two cells", () => {
    const tiny = computeFit({ width: 9, height: 9 }, CELL, "normal");
    expect(tiny).toMatchObject({ cols: 2, rows: 2 });
  });

  it("returns null while the container is mid-layout", () => {
    expect(computeFit({ width: 0, height: 0 }, CELL, "normal")).toBeNull();
    expect(computeFit({ width: 200, height: 200 }, { width: 0, height: 20 }, "normal")).toBeNull();
  });
});
