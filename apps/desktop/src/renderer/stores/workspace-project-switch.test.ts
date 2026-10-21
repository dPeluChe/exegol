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
const { useAgentStore } = await import("./agents");
const { useShortcutStore } = await import("./shortcuts");
const { goToShortcut } = await import("../lib/live-tabs");

const single = (id: string, paneId: string) => ({
  id,
  label: id,
  layout: { type: "pane" as const, paneId },
});

const projectA = (): ProjectWorkspace => ({
  tabs: [
    single("a1", "pa1"),
    single("a2", "pa2"),
    {
      id: "a3",
      label: "a3",
      layout: {
        type: "split",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          { type: "pane", paneId: "pa3x" },
          { type: "pane", paneId: "pa3y" },
        ],
      },
    },
  ],
  activeTabId: "a1",
  panes: {
    pa1: { id: "pa1", type: "terminal", agentId: "agentA" },
    pa2: { id: "pa2", type: "empty" },
    pa3x: { id: "pa3x", type: "empty" },
    pa3y: { id: "pa3y", type: "empty" },
  },
});

const projectB = (): ProjectWorkspace => ({
  tabs: [single("b1", "pb1")],
  activeTabId: "b1",
  panes: { pb1: { id: "pb1", type: "empty" } },
});

beforeEach(() => {
  useAppStore.getState().setActiveProject("A");
  useWorkspaceStore.setState({ projectWorkspaces: { A: projectA(), B: projectB() } });
  useAgentStore.setState({
    agents: {
      agentA: { id: "agentA", projectId: "A", status: "running" },
    } as unknown as ReturnType<typeof useAgentStore.getState>["agents"],
  });
  useShortcutStore.setState({ assigned: {} });
  const ws = useWorkspaceStore.getState();
  ws.setActiveTab("a3");
  ws.setFocusedPane("pa3y");
});

describe("switching project", () => {
  it("comes back to the tab and pane the project was left on", () => {
    useAppStore.getState().setActiveProject("B");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pb1");
    useAppStore.getState().setActiveProject("A");
    const ws = useWorkspaceStore.getState();
    expect(ws.projectWorkspaces.A?.activeTabId).toBe("a3");
    expect(ws.focusedPaneId).toBe("pa3y");
  });

  it("a project's own Cmd+n shows it as it was left, not its first live tab", () => {
    useShortcutStore.getState().assign("A", "2");
    useAppStore.getState().setActiveProject("B");
    expect(goToShortcut("2")).toBe("A:a1");
    const ws = useWorkspaceStore.getState();
    expect(useAppStore.getState().activeProjectId).toBe("A");
    expect(ws.projectWorkspaces.A?.activeTabId).toBe("a3");
    expect(ws.focusedPaneId).toBe("pa3y");
  });

  it("an automatic Cmd+n also shows the project as it was left, not its live tab", () => {
    useAppStore.getState().setActiveProject("B");
    expect(goToShortcut("2")).toBe("A:a1");
    const ws = useWorkspaceStore.getState();
    expect(useAppStore.getState().activeProjectId).toBe("A");
    expect(ws.projectWorkspaces.A?.activeTabId).toBe("a3");
    expect(ws.focusedPaneId).toBe("pa3y");
  });

  it("flashes the active tab when it is the live one", () => {
    useWorkspaceStore.getState().setActiveTab("a1");
    useAppStore.getState().setActiveProject("B");
    expect(goToShortcut("2")).toBe("A:a1");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pa1");
  });

  it("a digit no project has does nothing", () => {
    useAppStore.getState().setActiveProject("B");
    expect(goToShortcut("5")).toBeNull();
    expect(useAppStore.getState().activeProjectId).toBe("B");
  });
});

describe("projects kept mounted", () => {
  const projectC = (): ProjectWorkspace => ({
    tabs: [single("c1", "pc1")],
    activeTabId: "c1",
    panes: { pc1: { id: "pc1", type: "empty" } },
  });
  const projectD = (): ProjectWorkspace => ({
    tabs: [single("d1", "pd1")],
    activeTabId: "d1",
    panes: { pd1: { id: "pd1", type: "empty" } },
  });
  const tabA3 = () =>
    useWorkspaceStore.getState().projectWorkspaces.A?.tabs.find((t) => t.id === "a3");

  beforeEach(() => {
    useWorkspaceStore.setState((s) => ({
      projectWorkspaces: { ...s.projectWorkspaces, C: projectC(), D: projectD() },
      mountedProjects: ["A"],
    }));
  });

  it("keeps the last three projects shown, most recent first", () => {
    const app = useAppStore.getState();
    app.setActiveProject("B");
    expect(useWorkspaceStore.getState().mountedProjects).toEqual(["B", "A"]);
    app.setActiveProject("C");
    app.setActiveProject("D");
    expect(useWorkspaceStore.getState().mountedProjects).toEqual(["D", "C", "B"]);
    app.setActiveProject("B");
    expect(useWorkspaceStore.getState().mountedProjects).toEqual(["B", "D", "C"]);
  });

  it("no project shown keeps none mounted", () => {
    useAppStore.getState().setActiveProject("B");
    useAppStore.getState().setActiveProject(null);
    expect(useWorkspaceStore.getState().mountedProjects).toEqual([]);
  });

  it("a pane of a hidden kept project changes in its own project, never the active one", () => {
    useAppStore.getState().setActiveProject("B");
    useWorkspaceStore.getState().updatePane("pa2", { type: "terminal", agentId: "late-spawn" });
    const ws = useWorkspaceStore.getState();
    expect(ws.projectWorkspaces.A?.panes.pa2).toMatchObject({ agentId: "late-spawn" });
    expect(ws.projectWorkspaces.B).toEqual(projectB());
    expect(ws.focusedPaneId).toBe("pb1");
  });

  it("split sizes and equalize reach the tab's own project after a switch", () => {
    useAppStore.getState().setActiveProject("B");
    const ws = useWorkspaceStore.getState();
    ws.setSplitSizes("a3", [], [30, 70]);
    expect(tabA3()?.layout).toMatchObject({ sizes: [30, 70] });
    ws.equalizeSplits("a3");
    expect(tabA3()?.layout).toMatchObject({ sizes: [50, 50] });
    expect(useWorkspaceStore.getState().projectWorkspaces.B).toEqual(projectB());
  });

  it("removing a hidden project's pane leaves the active project and its focus alone", () => {
    useAppStore.getState().setActiveProject("B");
    useWorkspaceStore.getState().removePane("a3", "pa3x");
    const ws = useWorkspaceStore.getState();
    expect(tabA3()?.layout).toEqual({ type: "pane", paneId: "pa3y" });
    expect(ws.projectWorkspaces.A?.panes.pa3x).toBeUndefined();
    expect(ws.projectWorkspaces.B).toEqual(projectB());
    expect(ws.focusedPaneId).toBe("pb1");
    expect(ws._activeProjectId).toBe("B");
  });

  it("an unknown pane or tab changes nothing", () => {
    const before = useWorkspaceStore.getState().projectWorkspaces;
    const ws = useWorkspaceStore.getState();
    ws.updatePane("nope", { type: "git" });
    ws.setSplitSizes("nope", [], [10, 90]);
    ws.equalizeSplits("nope");
    ws.removePane("nope", "pa1");
    expect(useWorkspaceStore.getState().projectWorkspaces).toBe(before);
  });
});
