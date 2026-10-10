import { describe, expect, it } from "vitest";
import { movePaneToTab, releaseAgentPanes } from "./helpers";
import type { ProjectWorkspace } from "./types";

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
