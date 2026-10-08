import { describe, expect, it } from "vitest";
import { anchoredBox, DOCK_TOP, dockedBox, freeSpan, overlayBox } from "./overlay-position";

const viewport = { width: 1200, height: 800 };
const pane = { left: 300, top: 100, width: 900, height: 600 };
const free = () => ({ left: 200, right: 1200 });

describe("overlayBox", () => {
  it("sits over the target pane while it is on screen", () => {
    expect(overlayBox("pane", true, pane, viewport, 360, free)).toEqual({
      left: 570,
      top: 400,
      width: 360,
      docked: false,
    });
  });

  it("docks at the top center when the pane is not on screen (another project, tab or view)", () => {
    const box = overlayBox("pane", true, null, viewport, 360, free);
    expect(box).toEqual({ left: 420, top: DOCK_TOP, width: 360, docked: true });
  });

  it("the title bar setting docks even with the pane on screen", () => {
    expect(overlayBox("titlebar", true, pane, viewport, 360, free).docked).toBe(true);
    expect(overlayBox("titlebar", false, null, viewport, 360, free).docked).toBe(true);
  });

  it("with no pane to go to it centers on the window, as before", () => {
    const box = overlayBox("pane", false, null, viewport, 360, free);
    expect(box).toEqual({ left: 420, top: 400, width: 360, docked: false });
  });
});

describe("dockedBox", () => {
  it("never covers the traffic lights or the title bar's buttons", () => {
    const span = { left: 200, right: 700 };
    for (const width of [700, 800, 1000]) {
      const box = dockedBox(width, 420, span);
      expect(box.left).toBeGreaterThanOrEqual(span.left);
      expect(box.left + box.width).toBeLessThanOrEqual(span.right);
    }
  });

  it("shrinks to stay centered, then shifts once it would get too narrow", () => {
    expect(dockedBox(700, 400, { left: 200, right: 700 })).toMatchObject({ left: 208, width: 284 });
    expect(dockedBox(600, 400, { left: 200, right: 600 })).toMatchObject({ left: 208, width: 280 });
  });
});

describe("freeSpan", () => {
  it("is bounded by the controls on each side; one across the middle is covered", () => {
    const controls = [
      { left: 80, right: 210 },
      { left: 560, right: 640 },
      { left: 1100, right: 1180 },
      { left: 0, right: 0 },
    ];
    expect(freeSpan(1200, controls, 80)).toEqual({ left: 210, right: 1100 });
    expect(freeSpan(1200, [], 80)).toEqual({ left: 80, right: 1200 });
  });
});

describe("anchoredBox", () => {
  it("stays inside the window next to an edge", () => {
    expect(anchoredBox({ left: 0, top: 0, width: 200, height: 200 }, 1200, 360).left).toBe(8);
    expect(anchoredBox({ left: 1100, top: 0, width: 100, height: 200 }, 1200, 360).left).toBe(832);
  });
});
