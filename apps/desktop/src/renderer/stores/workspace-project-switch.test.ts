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
