import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "../stores/agents";

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", {
  api: {},
  localStorage: storage,
  addEventListener: () => {},
  dispatchEvent: () => true,
});
vi.stubGlobal("document", { querySelector: () => null });
vi.stubGlobal("CSS", { escape: (s: string) => s });

const deleteAgent = vi.fn();
vi.mock("../hooks/use-delete-agent", () => ({
  deleteAgent,
  pendingStop: () => Promise.resolve(),
}));
vi.mock("./trpc-client", () => ({ trpcInvoke: vi.fn(async () => []), trpcMutate: vi.fn() }));

const { closeWithConfirm, reopenClosed } = await import("./close-target");
const { useWorkspaceStore } = await import("../stores/workspace");
const { useAppStore } = await import("../stores/app");
const { useAgentStore } = await import("../stores/agents");
const { useCloseConfirmStore } = await import("../stores/close-confirm");
const { useToastStore } = await import("../stores/toasts");

const live = (id: string) => ({ id, cliType: "claude-code", status: "running" }) as AgentState;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  deleteAgent.mockClear();
  useToastStore.setState({ toasts: [] });
  useAppStore.getState().setActiveProject("P");
  useAgentStore.setState({ agents: { old: live("old"), swapped: live("swapped") } });
  useWorkspaceStore.setState({
    projectWorkspaces: {
      P: {
        tabs: [{ id: "t", label: "api", layout: { type: "pane", paneId: "p" } }],
        activeTabId: "t",
        panes: { p: { id: "p", type: "terminal", agentId: "old" } },
      },
    },
    focusedPaneId: "p",
    recentlyClosed: [],
  });
});

describe("closeWithConfirm", () => {
  it("a pane whose session changed while the dialog asked is asked again, not closed", async () => {
    const target = { tabId: "t", paneId: "p", paneIds: ["p"], closesTab: true };
    const closing = closeWithConfirm(target);
    await tick();
    expect(useCloseConfirmStore.getState().request).not.toBeNull();
    // useCliRestarts resumed the session into a new row meanwhile
    useWorkspaceStore.getState().updatePane("p", { agentId: "swapped" });
    useCloseConfirmStore.getState().answer(true);
    await tick();
    expect(deleteAgent).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useCloseConfirmStore.getState().request).not.toBeNull();
    useCloseConfirmStore.getState().answer(true);
    await closing;
    expect(deleteAgent).toHaveBeenCalledWith("swapped");
  });
});

describe("reopenClosed", () => {
  it("reopens nothing from another project", async () => {
    useWorkspaceStore.getState().rememberClosed({
      id: "e",
      projectId: "OTHER",
      closedAt: 1,
      kind: "tab",
      label: "x",
      panes: [{ id: "q", type: "git" }],
      sessions: [],
    });
    await reopenClosed();
    expect(useAppStore.getState().activeProjectId).toBe("P");
    expect(useWorkspaceStore.getState().recentlyClosed).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.title).toBe("Nothing to reopen in this project");
  });
});
