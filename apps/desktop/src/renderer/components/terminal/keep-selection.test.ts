import { describe, expect, it } from "vitest";
import { selectionLength, shouldRestore } from "./keep-selection";

const range = { start: { x: 4, y: 10 }, end: { x: 2, y: 12 } };

describe("selectionLength", () => {
  it("counts cells across rows", () => {
    expect(selectionLength(range, 80)).toBe(2 * 80 - 2);
    expect(selectionLength({ start: { x: 3, y: 5 }, end: { x: 9, y: 5 } }, 80)).toBe(6);
  });
});

describe("shouldRestore", () => {
  it("restores a selection a TUI's mouse report cleared", () => {
    expect(shouldRestore(range, true, 1_000, 2_000)).toBe(true);
  });

  it("lets a click, key or wheel clear it", () => {
    expect(shouldRestore(range, true, 1_900, 2_000)).toBe(false);
  });

  it("does nothing without mouse tracking or a saved selection", () => {
    expect(shouldRestore(range, false, 0, 2_000)).toBe(false);
    expect(shouldRestore(null, true, 0, 2_000)).toBe(false);
  });
});
