import { describe, expect, it } from "vitest";
import { nextMirrorFont } from "./terminal-setup";

/** Painted width with the cell rounded to half pixels, like xterm on a 2x display. */
const drawnAt = (cols: number, font: number) => (cols * Math.round(font * 0.6 * 2)) / 2;

function settle(cols: number, width: number, font: number) {
  let changes = 0;
  for (;;) {
    const next = nextMirrorFont(font, drawnAt(cols, font), width, 14);
    if (next === null) return { font, changes };
    font = next;
    changes++;
    if (changes > 50) return { font, changes };
  }
}

describe("nextMirrorFont", () => {
  it("settles at every card width and stays settled (no glyph-atlas rebuild loop)", () => {
    for (const cols of [80, 120, 160, 220]) {
      for (let width = 200; width <= 2000; width += 7) {
        const first = settle(cols, width, 14);
        expect(first.changes).toBeLessThanOrEqual(4);
        // Later triggers (resize observer, window resize) must not move it
        expect(settle(cols, width, first.font).changes).toBe(0);
        // Fits the card unless already at the smallest readable size
        if (first.font > 6) expect(drawnAt(cols, first.font)).toBeLessThanOrEqual(width + 1);
      }
    }
  });
});
