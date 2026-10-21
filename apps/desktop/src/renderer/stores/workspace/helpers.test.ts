import { describe, expect, it } from "vitest";
import {
  keepMounted,
  MOUNTED_PROJECTS_MAX,
  mountedLayers,
  mountedTerminals,
  movePaneToTab,
  projectOfPane,
  projectOfTab,
  releaseAgentPanes,
} from "./helpers";
import type { ProjectWorkspace, WorkspaceStore } from "./types";

const single = (tabId: string, paneId: string) => ({
  id: tabId,
  label: tabId,
  layout: { type: "pane" as const, paneId },
});

describe("releaseAgentPanes", () => {
  const pw: ProjectWorkspace = {
    tabs: [
      single("main", "a"),
      single("t2", "s1"),
      {
        id: "split",
        label: "split",
        layout: {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "s2" },
            { type: "pane", paneId: "web" },
          ],
          sizes: [50, 50],
        },
      },
    ],
    activeTabId: "t2",
    panes: {
      a: { id: "a", type: "empty" },
      s1: { id: "s1", type: "terminal", agentId: "shell-1" },
      s2: { id: "s2", type: "terminal", agentId: "shell-2" },
      web: { id: "web", type: "browser", url: "http://localhost:3000" },
    },
  };

  it("closes a tab left with nothing else, and moves off it", () => {
    const next = releaseAgentPanes(pw, "shell-1");
    expect(next?.tabs.map((t) => t.id)).toEqual(["main", "split"]);
    expect(next?.panes.s1).toBeUndefined();
    expect(next?.activeTabId).toBe("split");
  });

  it("turns the pane into a launcher when the tab still shows something", () => {
    const next = releaseAgentPanes(pw, "shell-2");
    expect(next?.tabs).toHaveLength(3);
    expect(next?.panes.s2).toEqual({ id: "s2", type: "empty", agentId: undefined });
  });

  it("keeps a project's only tab, and ignores sessions it does not show", () => {
    const only: ProjectWorkspace = { ...pw, tabs: [single("t2", "s1")], activeTabId: "t2" };
    expect(releaseAgentPanes(only, "shell-1")?.tabs).toHaveLength(1);
    expect(releaseAgentPanes(pw, "other")).toBeNull();
  });
});

describe("movePaneToTab", () => {
  const pw: ProjectWorkspace = {
    tabs: [
      single("solo", "s1"),
      {
        id: "split",
        label: "split",
        layout: {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "s2" },
            { type: "pane", paneId: "web" },
          ],
          sizes: [30, 70],
        },
        lastFocusedPaneId: "web",
      },
      single("fresh", "launcher"),
    ],
    activeTabId: "solo",
    panes: {
      s1: { id: "s1", type: "terminal", agentId: "shell-1" },
      s2: { id: "s2", type: "terminal", agentId: "shell-2" },
      web: { id: "web", type: "browser", url: "http://localhost:3000" },
      launcher: { id: "launcher", type: "empty" },
    },
  };

  it("closes the source tab when its only pane leaves, splitting beside the focused pane", () => {
    const next = movePaneToTab(pw, "solo", "s1", "split");
    expect(next?.tabs.map((t) => t.id)).toEqual(["split", "fresh"]);
    const split = next?.tabs[0];
    expect(split?.lastFocusedPaneId).toBe("s1");
    expect(split?.layout).toEqual({
      type: "split",
      direction: "horizontal",
      children: [
        { type: "pane", paneId: "s2" },
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "web" },
            { type: "pane", paneId: "s1" },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [30, 70],
    });
    expect(next?.panes.s1).toEqual(pw.panes.s1);
  });

  it("keeps the source tab with the rest, and takes the place of an empty launcher", () => {
    const next = movePaneToTab(pw, "split", "s2", "fresh");
    expect(next?.tabs.find((t) => t.id === "split")?.layout).toEqual({
      type: "pane",
      paneId: "web",
    });
    expect(next?.tabs.find((t) => t.id === "fresh")?.layout).toEqual({
      type: "pane",
      paneId: "s2",
    });
    expect(next?.panes.launcher).toBeUndefined();
    expect(next?.panes.s2?.agentId).toBe("shell-2");
  });

  it("does nothing for the same tab, a missing tab or a pane the source does not hold", () => {
    expect(movePaneToTab(pw, "solo", "s1", "solo")).toBeNull();
    expect(movePaneToTab(pw, "solo", "s1", "gone")).toBeNull();
    expect(movePaneToTab(pw, "solo", "web", "fresh")).toBeNull();
  });
});

describe("keepMounted (LRU of projects kept mounted)", () => {
  it("puts the shown project first and drops the least recent past the cap", () => {
    expect(keepMounted([], "A")).toEqual(["A"]);
    expect(keepMounted(["A"], "B")).toEqual(["B", "A"]);
    expect(keepMounted(["C", "B", "A"], "D")).toEqual(["D", "C", "B"]);
    expect(keepMounted(["C", "B", "A"], "A")).toEqual(["A", "C", "B"]);
    expect(keepMounted(["A", "B"], "B", 1)).toEqual(["B"]);
    expect(MOUNTED_PROJECTS_MAX).toBe(3);
  });

  it("returns the same list when the shown project already leads it", () => {
    const list = ["A", "B"];
    expect(keepMounted(list, "A")).toBe(list);
  });

  it("keeps nothing when no project is shown", () => {
    expect(keepMounted(["A", "B"], null)).toEqual([]);
  });
});

describe("mountedLayers", () => {
  it("always includes the active project, in a stable order an LRU reorder does not move", () => {
    expect(mountedLayers(["B", "A", "C"], "B")).toEqual(["A", "B", "C"]);
    expect(mountedLayers(["C", "B", "A"], "C")).toEqual(["A", "B", "C"]);
    expect(mountedLayers(["A"], "Z")).toEqual(["A", "Z"]);
    expect(mountedLayers([], null)).toEqual([]);
  });
});

describe("mountedTerminals", () => {
  it("counts the terminal views a kept project holds: no floating, launcher or broken pane", () => {
    const pw: ProjectWorkspace = {
      tabs: [],
      activeTabId: null,
      panes: {
        t1: { id: "t1", type: "terminal", agentId: "a1" },
        t2: { id: "t2", type: "terminal", agentId: "a2" },
        float: { id: "float", type: "terminal", agentId: "a3" },
        launcher: { id: "launcher", type: "terminal" },
        broken: { id: "broken", type: "terminal", agentId: "a4", invalidReason: "gone" },
        web: { id: "web", type: "browser" },
      },
    };
    expect(mountedTerminals(pw, { float: {} })).toBe(2);
  });
});

describe("projectOfPane / projectOfTab", () => {
  const ws = (active: string | null) =>
    ({
      _activeProjectId: active,
      projectWorkspaces: {
        A: {
          tabs: [single("ta", "pa")],
          activeTabId: "ta",
          panes: { pa: { id: "pa", type: "empty" } },
        },
        B: {
          tabs: [single("tb", "pb")],
          activeTabId: "tb",
          panes: { pb: { id: "pb", type: "empty" } },
        },
      },
    }) as unknown as WorkspaceStore;

  it("finds the project holding a pane or tab, whichever is active", () => {
    expect(projectOfPane(ws("B"), "pa")).toBe("A");
    expect(projectOfPane(ws("A"), "pb")).toBe("B");
    expect(projectOfTab(ws("B"), "ta")).toBe("A");
    expect(projectOfTab(ws(null), "tb")).toBe("B");
    expect(projectOfPane(ws("A"), "nope")).toBeNull();
    expect(projectOfTab(ws("A"), "nope")).toBeNull();
  });
});
