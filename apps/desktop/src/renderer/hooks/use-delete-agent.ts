import { useCallback } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { collectPaneIds, getProjectState, useWorkspaceStore } from "../stores/workspace";

/** Clean up panes and remove tabs that become all-empty after agent deletion */
function cleanupAgentPanes(agentId: string): void {
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();

  for (const [paneId, pane] of Object.entries(pw.panes)) {
    if (pane.type === "terminal" && pane.agentId === agentId) {
      // Find the tab that owns this pane
      const ownerTab = pw.tabs.find((t) => collectPaneIds(t.layout).includes(paneId));
      if (!ownerTab) continue;

      const paneIds = collectPaneIds(ownerTab.layout);
      const isSinglePane = paneIds.length === 1;

      // Check if all OTHER panes in this tab are also empty
      const allOthersEmpty = paneIds
        .filter((pid) => pid !== paneId)
        .every((pid) => pw.panes[pid]?.type === "empty");

      if (isSinglePane || allOthersEmpty) {
        ws.removeTab(ownerTab.id);
      } else {
        ws.updatePane(paneId, { type: "empty", agentId: undefined });
      }
    }
  }
}

/**
 * Hook: stop + delete + cleanup agent from store + panes.
 */
export function useDeleteAgent() {
  const removeAgent = useAgentStore((s) => s.removeAgent);

  return useCallback(
    async (agentId: string) => {
      trpcMutate("agents.stop", { id: agentId }).catch(() => {});
      await trpcMutate("agents.delete", { id: agentId }).catch(() => {});
      removeAgent(agentId);
      cleanupAgentPanes(agentId);
    },
    [removeAgent],
  );
}

/** Imperative version (for use outside React components, e.g., hotkeys) */
export function deleteAgentImperative(agentId: string): void {
  trpcMutate("agents.stop", { id: agentId }).catch(() => {});
  trpcMutate("agents.delete", { id: agentId }).catch(() => {});
  useAgentStore.getState().removeAgent(agentId);
  cleanupAgentPanes(agentId);
}
