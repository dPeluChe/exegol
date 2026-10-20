import { describe, expect, it } from "vitest";
import type { LayoutNode } from "../../stores/workspace/types";
import {
  anchorRect,
  dockedPill,
  freeSpan,
  NO_OFFSET,
  offsetAt,
  offsetBox,
  offsetOf,
  overlayMode,
  paneOnScreen,
} from "./overlay-position";

const layout: LayoutNode = {
  type: "split",
  direction: "horizontal",
  sizes: [50, 50],
  children: [
    { type: "pane", paneId: "p1" },
    { type: "pane", paneId: "p2" },
  ],
} as LayoutNode;

const ws = (floating: Record<string, unknown> = {}) => ({
  projectWorkspaces: {
    a: {
      tabs: [
        { id: "t1", label: "1", layout },
        { id: "t2", label: "2", layout: { type: "pane", paneId: "p3" } as LayoutNode },
      ],
      activeTabId: "t1",
    },
  },
  floatingPanes: floating,
});
const view = { activeView: "workspace", workspaceSection: "agents", activeProjectId: "a" };

describe("paneOnScreen", () => {
  it("is on screen in its project's active tab of the Agents section", () => {
    expect(paneOnScreen(view, ws(), "p2")).toBe(true);
  });

  it("is off screen in another tab, project, section or view, or floated out", () => {
    expect(paneOnScreen(view, ws(), "p3")).toBe(false);
    expect(paneOnScreen({ ...view, activeProjectId: "b" }, ws(), "p1")).toBe(false);
    expect(paneOnScreen({ ...view, workspaceSection: "tasks" }, ws(), "p1")).toBe(false);
    expect(paneOnScreen({ ...view, activeView: "dashboard" }, ws(), "p1")).toBe(false);
    expect(paneOnScreen({ ...view, activeView: "projects" }, ws(), "p1")).toBe(false);
    expect(paneOnScreen(view, ws({ p1: {} }), "p1")).toBe(false);
  });
});

describe("overlayMode", () => {
  it("sits over the pane while it is on screen, docks while it is not", () => {
    expect(overlayMode("pane", true, true, true)).toBe("pane");
    expect(overlayMode("pane", true, false, true)).toBe("dock");
  });

  it("the title bar setting docks a recording even with the pane on screen", () => {
    expect(overlayMode("titlebar", true, true, true)).toBe("dock");
    expect(overlayMode("titlebar", false, false, true)).toBe("dock");
  });

  it("a panel with buttons, or a dictation with no pane, centers on the window", () => {
    expect(overlayMode("pane", true, false, false)).toBe("window");
    expect(overlayMode("titlebar", true, true, false)).toBe("window");
    expect(overlayMode("pane", false, false, true)).toBe("window");
  });
});

describe("dockedPill", () => {
  const free = { left: 210, right: 1200 };

  it("sits right of the project name, never over it or the title bar's buttons", () => {
    const pill = dockedPill(free, { left: 560, right: 640 }, 440);
    expect(pill).toEqual({ left: 652, width: 440 });
    expect(pill.left + pill.width).toBeLessThanOrEqual(free.right);
  });

  it("goes left of the name when the right side is too narrow", () => {
    const pill = dockedPill({ left: 210, right: 760 }, { left: 560, right: 640 }, 440);
    expect(pill.left + pill.width).toBeLessThanOrEqual(548);
    expect(pill.left).toBeGreaterThanOrEqual(218);
  });

  it("with no room beside the name, it is centered over the free span", () => {
    const pill = dockedPill({ left: 400, right: 800 }, { left: 560, right: 640 }, 440);
    expect(pill).toEqual({ left: 408, width: 384 });
  });
});

describe("freeSpan", () => {
  it("is bounded by the controls on each side; one across the middle is ignored", () => {
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

const viewport = { width: 1200, height: 800 };
const card = { width: 360, height: 200 };

describe("offsetBox", () => {
  it("with no offset, centers on the anchor and stays inside the window next to an edge", () => {
    const pane = { left: 400, top: 100, width: 600, height: 600 };
    expect(offsetBox(pane, viewport, card, NO_OFFSET)).toEqual({
      left: 520,
      top: 400,
      width: 360,
      docked: false,
    });
    const narrowLeft = { left: 0, top: 0, width: 200, height: 200 };
    expect(offsetBox(narrowLeft, viewport, card, NO_OFFSET).left).toBe(8);
    const narrowRight = { left: 1100, top: 0, width: 100, height: 200 };
    expect(offsetBox(narrowRight, viewport, card, NO_OFFSET).left).toBe(832);
  });

  it("follows the offset and is kept inside the pane it sits over", () => {
    const pane = { left: 400, top: 100, width: 600, height: 600 };
    const moved = offsetBox(pane, viewport, card, { fx: -50 / 300, fy: 120 / 300 });
    expect(moved.left).toBeCloseTo(470);
    expect(moved.top).toBeCloseTo(520);
    const far = offsetBox(pane, viewport, card, { fx: 1, fy: -1 });
    expect(far).toMatchObject({ left: 1000 - 8 - 360, top: 100 + 8 + 100 });
  });

  it("a pane too small for the card clamps that axis to the window instead", () => {
    const pane = { left: 1000, top: 600, width: 200, height: 150 };
    const box = offsetBox(pane, viewport, card, { fx: 0, fy: 1 });
    expect(box.left).toBe(832);
    expect(box.top).toBe(800 - 8 - 100);
  });

  it("a part of the pane past the window does not count", () => {
    const pane = { left: -300, top: 0, width: 900, height: 800 };
    expect(offsetBox(pane, viewport, card, { fx: -1, fy: 0 }).left).toBe(8);
  });

  it("offsetOf gives back the offset of a box that was not clamped", () => {
    const pane = { left: 400, top: 100, width: 600, height: 600 };
    const offset = { fx: -0.25, fy: 0.5 };
    expect(offsetOf(offsetBox(pane, viewport, card, offset), pane)).toEqual(offset);
    const window = { left: 0, top: 0, ...viewport };
    const clamped = offsetOf(offsetBox(window, viewport, card, { fx: 1, fy: 0 }), window);
    expect(clamped).toEqual({ fx: (1200 - 8 - 180 - 600) / 600, fy: 0 });
  });

  it("offsetAt is a fraction of the anchor, clamped to it", () => {
    const pane = { left: 400, top: 100, width: 600, height: 600 };
    expect(offsetAt(850, 400, pane)).toEqual({ fx: 0.5, fy: 0 });
    expect(offsetAt(5000, -5000, pane)).toEqual({ fx: 1, fy: -1 });
  });
});

describe("anchor in a tab split in two panes", () => {
  // Title bar 40 px, sidebar 0: the left pane (the terminal) and the right one (a launcher)
  const left = { left: 0, top: 40, width: 600, height: 760 };
  const right = { left: 600, top: 40, width: 600, height: 760 };

  it("anchors on the target pane's rect, centered over it", () => {
    const anchor = anchorRect("pane", left, viewport);
    expect(anchor).toEqual(left);
    const box = offsetBox(anchor, viewport, card, NO_OFFSET);
    expect(box.left + box.width / 2).toBe(300);
    expect(box.top).toBe(40 + 380);
    const other = offsetBox(anchorRect("pane", right, viewport), viewport, card, NO_OFFSET);
    expect(other.left + other.width / 2).toBe(900);
  });

  it("falls back to the window with no pane, a hidden pane, or in window mode", () => {
    const window = { left: 0, top: 0, ...viewport };
    expect(anchorRect("pane", null, viewport)).toEqual(window);
    expect(anchorRect("pane", { left: 0, top: 0, width: 0, height: 0 }, viewport)).toEqual(window);
    expect(anchorRect("window", left, viewport)).toEqual(window);
  });

  it("a spot dragged in the full-width pane keeps its relative place in the half one", () => {
    const full = { left: 0, top: 40, width: 1200, height: 760 };
    const dragged = offsetAt(600 + 150, 420, full);
    const box = offsetBox(anchorRect("pane", left, viewport), viewport, card, dragged);
    expect(box.left + box.width / 2).toBe(300 + 75);
    expect(box.left + box.width).toBeLessThanOrEqual(600);
  });
});
