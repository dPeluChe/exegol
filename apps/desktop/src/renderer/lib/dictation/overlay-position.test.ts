import { describe, expect, it } from "vitest";
import type { LayoutNode } from "../../stores/workspace/types";
import { anchoredBox, dockedPill, freeSpan, overlayMode, paneOnScreen } from "./overlay-position";

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

describe("anchoredBox", () => {
  it("stays inside the window next to an edge", () => {
    expect(anchoredBox({ left: 0, top: 0, width: 200, height: 200 }, 1200, 360).left).toBe(8);
    expect(anchoredBox({ left: 1100, top: 0, width: 100, height: 200 }, 1200, 360).left).toBe(832);
  });
});
