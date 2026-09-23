import { describe, expect, it } from "vitest";
import { nextMirrorFont } from "./terminal-setup";

/** Painted grid with cells rounded to half pixels, like xterm on a 2x display. */
const drawnAt = (cols: number, rows: number, font: number) => ({
  width: (cols * Math.round(font * 0.6 * 2)) / 2,
  height: (rows * Math.round(font * 1.2 * 2)) / 2,
});

function settle(cols: number, rows: number, host: { width: number; height: number }, font: number) {
  let changes = 0;
  for (;;) {
    const next = nextMirrorFont(font, drawnAt(cols, rows, font), host, 14);
    if (next === null || changes > 50) return { font, changes };
    font = next;
    changes++;
  }
}

describe("nextMirrorFont", () => {
  it("settles in both dimensions and stays settled (no glyph-atlas rebuild loop)", () => {
    for (const [cols, rows] of [
      [80, 24],
      [160, 50],
      [234, 60],
    ] as const) {
      for (let width = 240; width <= 2000; width += 23) {
        for (let height = 240; height <= 1400; height += 37) {
          const host = { width, height };
          const first = settle(cols, rows, host, 14);
          expect(first.changes).toBeLessThanOrEqual(5);
          // Later triggers (resize observer, window resize) must not move it
          expect(settle(cols, rows, host, first.font).changes).toBe(0);
          if (first.font > 6) {
            const drawn = drawnAt(cols, rows, first.font);
            expect(drawn.width).toBeLessThanOrEqual(width + 1);
            expect(drawn.height).toBeLessThanOrEqual(height + 1);
          }
        }
      }
    }
  });
});
