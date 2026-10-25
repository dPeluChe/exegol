import { describe, expect, it } from "vitest";
import {
  createGpuRepaintGate,
  GPU_DROP_EVENT,
  GPU_REPAINT_EVENT,
  type GpuRepaintDetail,
  repaintTerminals,
} from "./gpu-repaint";

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

describe("repaintTerminals", () => {
  /** Views like use-xterm's: drop on the first event, count and rebuild on the second */
  function setup(names: string[], missDrop: string[] = []) {
    const target = new EventTarget();
    const steps: string[] = [];
    const holding = new Set(names);
    for (const name of names) {
      if (!missDrop.includes(name)) {
        target.addEventListener(GPU_DROP_EVENT, () => {
          steps.push(`drop ${name}`);
          holding.delete(name);
        });
      }
      target.addEventListener(GPU_REPAINT_EVENT, (e) => {
        steps.push(`rebuild ${name}`);
        (e as CustomEvent<GpuRepaintDetail>).detail.views++;
        holding.add(name);
      });
    }
    return { target, steps, live: () => holding.size };
  }

  it("every view drops before any rebuilds, so no old context holds the atlas", () => {
    const { target, steps, live } = setup(["a", "b", "c"]);
    expect(repaintTerminals(target, live)).toEqual({
      views: 3,
      before: 3,
      afterDrop: 0,
      rebuilt: 3,
    });
    expect(steps).toEqual(["drop a", "drop b", "drop c", "rebuild a", "rebuild b", "rebuild c"]);
  });

  it("reports a context that outlived the drop", () => {
    const { target, live } = setup(["a", "b"], ["b"]);
    expect(repaintTerminals(target, live).afterDrop).toBe(1);
  });
});
