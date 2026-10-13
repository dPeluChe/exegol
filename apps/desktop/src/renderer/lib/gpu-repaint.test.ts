import { describe, expect, it } from "vitest";
import { createGpuRepaintGate } from "./gpu-repaint";

const hidden = { visible: false, focused: false };
const visibleUnfocused = { visible: true, focused: false };
const focused = { visible: true, focused: true };

describe("createGpuRepaintGate", () => {
  it("repaints at once, and owes nothing, when the window is seen with the focus", () => {
    const gate = createGpuRepaintGate();
    expect(gate.lost(focused)).toBe(true);
    expect(gate.isPending()).toBe(false);
    expect(gate.shown(focused)).toBe(false);
  });

  it("holds a loss seen while hidden until the window is visible again", () => {
    const gate = createGpuRepaintGate();
    expect(gate.lost(hidden)).toBe(false);
    expect(gate.shown(hidden)).toBe(false);
    expect(gate.shown(focused)).toBe(true);
    expect(gate.shown(focused)).toBe(false);
  });

  it("repaints a visible but unfocused window now and once more on focus", () => {
    const gate = createGpuRepaintGate();
    expect(gate.lost(visibleUnfocused)).toBe(true);
    expect(gate.shown(visibleUnfocused)).toBe(true);
    expect(gate.shown(focused)).toBe(true);
    expect(gate.isPending()).toBe(false);
    expect(gate.shown(focused)).toBe(false);
  });

  it("never repaints on a reveal without a loss", () => {
    const gate = createGpuRepaintGate();
    expect(gate.shown(focused)).toBe(false);
    expect(gate.shown(visibleUnfocused)).toBe(false);
  });

  it("a second crash while hidden is still one repaint", () => {
    const gate = createGpuRepaintGate();
    gate.lost(hidden);
    gate.lost(hidden);
    expect(gate.shown(focused)).toBe(true);
    expect(gate.shown(focused)).toBe(false);
  });
});
