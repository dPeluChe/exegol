import { useCallback } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { getProjectState, useWorkspaceStore } from "../stores/workspace";

/**
 * Hook: stop + delete + cleanup agent from store + panes.
 * Consolidates the pattern used in AgentMiniCard, WorkspaceTabBar, use-hotkeys, WorkspacePane.
 */
export function useDeleteAgent() {
  const removeAgent = useAgentStore((s) => s.removeAgent);

  return useCallback(
    async (agentId: string) => {
      trpcMutate("agents.stop", { id: agentId }).catch(() => {});
      await trpcMutate("agents.delete", { id: agentId }).catch(() => {});
      removeAgent(agentId);

      // Convert any terminal pane showing this agent to empty
      const ws = useWorkspaceStore.getState();
      for (const [paneId, pane] of Object.entries(getProjectState().panes)) {
        if (pane.type === "terminal" && pane.agentId === agentId) {
          ws.updatePane(paneId, { type: "empty", agentId: undefined });
        }
      }
    },
    [removeAgent],
  );
}

/** Imperative version (for use outside React components, e.g., hotkeys) */
export function deleteAgentImperative(agentId: string): void {
  trpcMutate("agents.stop", { id: agentId }).catch(() => {});
  trpcMutate("agents.delete", { id: agentId }).catch(() => {});
  useAgentStore.getState().removeAgent(agentId);

  const ws = useWorkspaceStore.getState();
  for (const [paneId, pane] of Object.entries(getProjectState().panes)) {
    if (pane.type === "terminal" && pane.agentId === agentId) {
      ws.updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }
}
