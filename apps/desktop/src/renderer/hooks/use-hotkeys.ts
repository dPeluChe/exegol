import { useEffect } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { type AgentState, useAgentStore } from "../stores/agents";
import { useAppStore } from "../stores/app";
import { collectPaneIds, useWorkspaceStore } from "../stores/workspace";

export function useHotkeys() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setActiveView = useAppStore((s) => s.setActiveView);

  // Rule 4: external system sync — global keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Win/Linux

      if (!mod) return;

      // Cmd+B: Toggle sidebar
      if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+T: New workspace tab
      if (e.key === "t") {
        e.preventDefault();
        useWorkspaceStore.getState().addTab();
        return;
      }

      // Cmd+W: Close focused pane (or tab if last pane) + stop terminal agents
      if (e.key === "w") {
        e.preventDefault();
        cleanupAndCloseFocusedPane();
        return;
      }

      // Cmd+,: Open Settings
      if (e.key === ",") {
        e.preventDefault();
        setActiveView("settings");
        return;
      }

      // Cmd+Shift+P: Go to Projects
      if (e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        useAppStore.getState().setActiveProject(null);
        return;
      }

      // Cmd+Shift+D: Split vertical
      if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("exegol:split-pane", { detail: { direction: "vertical" } }),
        );
        return;
      }

      // Cmd+D: Split horizontal
      if (e.key === "d") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("exegol:split-pane", { detail: { direction: "horizontal" } }),
        );
        return;
      }

      // Cmd+N: New Agent (open spawn dialog)
      if (e.key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("exegol:spawn-agent"));
        return;
      }

      // Cmd+.: Stop focused agent
      if (e.key === ".") {
        e.preventDefault();
        const { focusedAgentId } = useAgentStore.getState();
        if (focusedAgentId) {
          window.dispatchEvent(
            new CustomEvent("exegol:stop-agent", {
              detail: { agentId: focusedAgentId },
            }),
          );
        }
        return;
      }

      // Read agents snapshot only when needed (avoids stale-closure + re-render issues)
      const agentSnapshot = Object.values(useAgentStore.getState().agents);
      const { focusedAgentId, setFocusedAgent } = useAgentStore.getState();

      // Cmd+]: Next tab (next agent)
      if (e.key === "]") {
        e.preventDefault();
        navigateAgentTab("next", agentSnapshot, focusedAgentId, setFocusedAgent);
        return;
      }

      // Cmd+[: Previous tab (previous agent)
      if (e.key === "[") {
        e.preventDefault();
        navigateAgentTab("prev", agentSnapshot, focusedAgentId, setFocusedAgent);
        return;
      }

      // Cmd+1-9: Switch to agent session by index (sidebar agents)
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < agentSnapshot.length) {
          setFocusedAgent(agentSnapshot[index]?.id ?? null);
          if (useAppStore.getState().activeView !== "workspace") {
            setActiveView("workspace");
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, setActiveView]);
}

/** Stop agents in terminal panes, then close the focused pane/tab */
function cleanupAndCloseFocusedPane(): void {
  const ws = useWorkspaceStore.getState();
  const { focusedPaneId, activeTabId, tabs, panes } = ws;
  if (!focusedPaneId || !activeTabId) return;

  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const allPaneIds = collectPaneIds(tab.layout);
  const isLastPane = allPaneIds.length <= 1;

  // Collect panes to clean up: if last pane → all panes in tab, otherwise just the focused one
  const paneIdsToClean = isLastPane ? allPaneIds : [focusedPaneId];

  for (const pid of paneIdsToClean) {
    const pane = panes[pid];
    if (pane?.type === "terminal" && pane.agentId) {
      const agentId = pane.agentId;
      trpcMutate("agents.stop", { id: agentId })
        .catch(() => {})
        .then(() => trpcMutate("agents.delete", { id: agentId }).catch(() => {}));
      useAgentStore.getState().removeAgent(agentId);
    }
  }

  ws.closeFocusedPane();
}

function navigateAgentTab(
  direction: "next" | "prev",
  agents: AgentState[],
  focusedAgentId: string | null,
  setFocusedAgent: (id: string | null) => void,
) {
  if (agents.length === 0) return;
  if (!focusedAgentId) {
    setFocusedAgent(agents[0]?.id ?? null);
    return;
  }
  const currentIndex = agents.findIndex((a) => a.id === focusedAgentId);
  const nextIndex =
    direction === "next"
      ? (currentIndex + 1) % agents.length
      : (currentIndex - 1 + agents.length) % agents.length;
  setFocusedAgent(agents[nextIndex]?.id ?? null);
}
