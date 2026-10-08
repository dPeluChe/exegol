import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWorkspace } from "./workspace/types";

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", {
  api: {},
  localStorage: storage,
  addEventListener: () => {},
  dispatchEvent: () => true,
});

const { useWorkspaceStore } = await import("./workspace");
const { useAppStore } = await import("./app");
const { onWorkspaceRehydrate } = await import("./workspace/recovery");
const { focusInActiveTab, getPw, layoutHasPane, resolveCloseTarget } = await import(
  "./workspace/helpers"
);

/** Tab "live": the besalt session alone. Tab "blank": two launchers side by side */
const project = (): ProjectWorkspace => ({
  tabs: [
    { id: "live", label: "besalt", layout: { type: "pane", paneId: "besalt" } },
    {
      id: "blank",
      label: "Tab 2",
      layout: {
        type: "split",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          { type: "pane", paneId: "l1" },
          { type: "pane", paneId: "l2" },
        ],
      },
    },
  ],
  activeTabId: "live",
  panes: {
    besalt: { id: "besalt", type: "empty" },
    l1: { id: "l1", type: "empty" },
    l2: { id: "l2", type: "empty" },
  },
});

const ws = () => useWorkspaceStore.getState();
const pw = () => getPw(ws());
const invariant = () => expect(focusInActiveTab(pw(), ws().focusedPaneId)).toBe(true);
const besaltIntact = () => {
  const live = pw().tabs.find((t) => t.id === "live");
  expect(live && layoutHasPane(live.layout, "besalt")).toBe(true);
  expect(pw().panes.besalt?.agentId).toBe("besalt-agent");
};

beforeEach(() => {
  useAppStore.getState().setActiveProject("P");
  useWorkspaceStore.setState({ projectWorkspaces: { P: project() }, focusedPaneId: "besalt" });
});

describe("Cmd+W closes only the active tab's pane", () => {
  it("a spawn landing in a background tab does not take the focus, so Cmd+W spares it", () => {
    ws().setActiveTab("blank");
    // besalt's launch resolves after the user moved to the other tab (use-spawn-agent)
    ws().updatePane("besalt", { type: "terminal", agentId: "besalt-agent" });
    invariant();
    ws().closeFocusedPane();
    besaltIntact();
    expect(pw().activeTabId).toBe("blank");
  });

  it("a focus request for another tab's pane is refused", () => {
    ws().updatePane("besalt", { type: "terminal", agentId: "besalt-agent" });
    ws().setActiveTab("blank");
    ws().setFocusedPane("besalt");
    invariant();
    expect(resolveCloseTarget(pw(), "besalt")?.tabId).toBe("blank");
  });

  it("a stale focus outside the active tab resolves to the active tab's own pane", () => {
    ws().updatePane("besalt", { type: "terminal", agentId: "besalt-agent" });
    useWorkspaceStore.setState({
      projectWorkspaces: { P: { ...pw(), activeTabId: "blank" } },
      focusedPaneId: "besalt",
    });
    ws().closeFocusedPane();
    besaltIntact();
    expect(resolveCloseTarget(pw(), "besalt")).toEqual({
      tabId: "blank",
      paneId: expect.not.stringMatching("besalt"),
      paneIds: [expect.not.stringMatching("besalt")],
      closesTab: true,
    });
  });
});

describe("every change of the active tab moves the focus with it", () => {
  it("tab click and Cmd+Shift+]: the tab's last focused pane, else its first", () => {
    ws().setActiveTab("blank");
    expect(ws().focusedPaneId).toBe("l1");
    ws().setFocusedPane("l2");
    ws().setActiveTab("live");
    expect(ws().focusedPaneId).toBe("besalt");
    ws().setActiveTab("blank");
    expect(ws().focusedPaneId).toBe("l2");
    invariant();
  });

  it("closing the active tab hands the focus to the tab that becomes active", () => {
    ws().removeTab("live");
    expect(pw().activeTabId).toBe("blank");
    invariant();
  });

  it("a session released from the active tab closes it and moves the focus", () => {
    ws().updatePane("besalt", { type: "terminal", agentId: "besalt-agent" });
    ws().releaseAgent("besalt-agent");
    expect(pw().activeTabId).toBe("blank");
    invariant();
  });

  it("merging tabs, extracting a pane, adding a tab", () => {
    ws().mergeTabIntoSplit("live", "blank", "horizontal");
    invariant();
    ws().extractPaneToNewTab("blank", "l2");
    expect(ws().focusedPaneId).toBe("l2");
    invariant();
    ws().addTab();
    invariant();
  });

  it("closing a pane keeps the focus in its tab", () => {
    ws().setActiveTab("blank");
    ws().removePane("blank", "l1");
    expect(ws().focusedPaneId).toBe("l2");
    invariant();
  });

  it("Cmd+D splits the active tab even with a stale focus", () => {
    useWorkspaceStore.setState({
      projectWorkspaces: { P: { ...pw(), activeTabId: "blank" } },
      focusedPaneId: "besalt",
    });
    ws().splitFocusedPane("vertical");
    const live = pw().tabs.find((t) => t.id === "live");
    expect(live?.layout).toEqual({ type: "pane", paneId: "besalt" });
    expect(Object.keys(pw().panes)).toHaveLength(4);
  });
});

describe("focus only moves when asked", () => {
  it("a spawn finishing in pane B does not take the focus from pane A in the same tab", () => {
    ws().setActiveTab("blank");
    ws().setFocusedPane("l1");
    ws().updatePane("l2", { type: "terminal", agentId: "late-agent" });
    expect(ws().focusedPaneId).toBe("l1");
  });

  it("setFocusedPane takes null or a pane of the active tab, nothing else", () => {
    ws().setFocusedPane("nowhere");
    expect(ws().focusedPaneId).toBe("besalt");
    ws().setFocusedPane(null);
    expect(ws().focusedPaneId).toBeNull();
  });

  it("setActiveTab(tab, pane) activates and focuses in one step", () => {
    ws().setActiveTab("blank", "l2");
    expect(pw().activeTabId).toBe("blank");
    expect(ws().focusedPaneId).toBe("l2");
  });

  it("a project switch comes back to the pane its active tab was left on", () => {
    ws().setActiveTab("blank", "l2");
    useAppStore.getState().setActiveProject("Q");
    expect(ws().focusedPaneId).toBeNull();
    useAppStore.getState().setActiveProject("P");
    expect(ws().focusedPaneId).toBe("l2");
    expect(pw().tabs.find((t) => t.id === "blank")?.lastFocusedPaneId).toBe("l2");
  });

  it("a persisted per-project focus moves to its active tab on load", () => {
    const base = project();
    // A launcher-only split collapses on load: l2 holds a terminal to stay
    const panes = { ...base.panes, l2: { id: "l2", type: "terminal" as const, agentId: "a" } };
    const legacy = { ...base, panes, activeTabId: "blank", lastFocusedPaneId: "l2" };
    const state = { projectWorkspaces: { P: legacy } } as unknown as Parameters<
      typeof onWorkspaceRehydrate
    >[0];
    onWorkspaceRehydrate(state);
    const loaded = state?.projectWorkspaces.P;
    expect(loaded && "lastFocusedPaneId" in loaded).toBe(false);
    expect(loaded?.tabs.find((t) => t.id === "blank")?.lastFocusedPaneId).toBe("l2");
  });
});

describe("reopen a closed tab", () => {
  it("closeTarget then restoreClosed puts the tab back at its index", () => {
    const target = resolveCloseTarget(pw(), ws().focusedPaneId);
    if (!target) throw new Error("no target");
    ws().rememberClosed({
      id: "e1",
      projectId: "P",
      closedAt: 1,
      kind: "tab",
      label: "besalt",
      tab: { id: "live", layout: { type: "pane", paneId: "besalt" }, index: 0 },
      panes: [{ id: "besalt", type: "terminal", agentId: "besalt-agent" }],
      sessions: [
        {
          paneId: "besalt",
          agentId: "besalt-agent",
          cliType: "claude-code",
          name: "besalt",
          taskDescription: "",
          branchName: null,
          accessMode: null,
        },
      ],
    });
    ws().closeTarget(target);
    expect(pw().tabs.map((t) => t.id)).toEqual(["blank"]);
    expect(ws().restoreClosed("e1")).toEqual({ tabId: "live", paneId: "besalt" });
    expect(pw().tabs.map((t) => t.id)).toEqual(["live", "blank"]);
    expect(pw().activeTabId).toBe("live");
    // The session's pane waits as a launcher until its resume lands
    expect(pw().panes.besalt).toEqual({ id: "besalt", type: "empty" });
    expect(ws().recentlyClosed).toEqual([]);
    invariant();
  });
});
