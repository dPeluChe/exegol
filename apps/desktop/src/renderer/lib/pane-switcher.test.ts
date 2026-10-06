import { describe, expect, it } from "vitest";
import type { WorkspaceTab } from "../stores/workspace/types";
import {
  buildSwitcherItems,
  initialIndex,
  isQuickSwitch,
  lastPaneOfTab,
  QUICK_SWITCH_MS,
  quickSwitchTarget,
  stepIndex,
  tabsByMru,
  touchMru,
} from "./pane-switcher";

function tab(id: string, panes: string[]): WorkspaceTab {
  const [first] = panes;
  return {
    id,
    label: id,
    layout:
      panes.length === 1 && first
        ? { type: "pane", paneId: first }
        : {
            type: "split",
            direction: "horizontal",
            children: panes.map((paneId) => ({ type: "pane" as const, paneId })),
            sizes: panes.map(() => 100 / panes.length),
          },
  };
}

const T1 = tab("t1", ["a", "b"]);
const T2 = tab("t2", ["c"]);
const T3 = tab("t3", ["d", "e"]);

describe("touchMru", () => {
  it("moves the pane to the front without duplicates", () => {
    expect(touchMru([], "a")).toEqual(["a"]);
    expect(touchMru(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    const same = ["a", "b"];
    expect(touchMru(same, "a")).toBe(same);
  });
});

describe("MRU order", () => {
  it("orders tabs by their latest pane, unused tabs last in their order", () => {
    expect(tabsByMru([T1, T2, T3], ["c", "e"]).map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
    expect(tabsByMru([T1, T2, T3], []).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("picks a tab's last used pane, else its first", () => {
    expect(lastPaneOfTab(T3, ["c", "e", "d"])).toBe("e");
    expect(lastPaneOfTab(T3, ["c"])).toBe("d");
  });
});

describe("buildSwitcherItems", () => {
  it("flattens tab rows followed by their panes in layout order", () => {
    expect(buildSwitcherItems([T1, T2], ["c", "b"])).toEqual([
      { kind: "tab", tabId: "t2", paneId: "c" },
      { kind: "pane", tabId: "t2", paneId: "c" },
      { kind: "tab", tabId: "t1", paneId: "b" },
      { kind: "pane", tabId: "t1", paneId: "a" },
      { kind: "pane", tabId: "t1", paneId: "b" },
    ]);
  });
});

describe("stepIndex", () => {
  it("wraps both ways", () => {
    expect(stepIndex(0, 3, "next")).toBe(1);
    expect(stepIndex(2, 3, "next")).toBe(0);
    expect(stepIndex(0, 3, "prev")).toBe(2);
    expect(stepIndex(0, 0, "next")).toBe(-1);
  });
});

describe("quick switch", () => {
  it("goes to the pane used before the current one that still exists", () => {
    const existing = new Set(["a", "b", "c"]);
    expect(quickSwitchTarget(["a", "x", "c"], "a", existing)).toBe("c");
    expect(quickSwitchTarget(["a"], "a", existing)).toBeNull();
    expect(quickSwitchTarget(["b", "a"], "other-project", existing)).toBe("b");
  });

  it("is quick only for one press released before the overlay shows", () => {
    expect(isQuickSwitch(1, 50)).toBe(true);
    expect(isQuickSwitch(1, QUICK_SWITCH_MS)).toBe(false);
    expect(isQuickSwitch(2, 50)).toBe(false);
  });

  it("starts the highlight on the previous pane, or above the current one going back", () => {
    const items = buildSwitcherItems([T1, T2], ["b", "c"]);
    // t1, a, b, t2, c
    expect(initialIndex(items, "b", "c", "next")).toBe(4);
    expect(initialIndex(items, "b", null, "next")).toBe(3);
    expect(initialIndex(items, "b", "c", "prev")).toBe(1);
    expect(initialIndex([], "b", "c", "next")).toBe(-1);
  });
});
