import { useCallback } from "react";
import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { useWorkspaceStore } from "../stores/workspace";

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
      useWorkspaceStore.getState().releaseAgent(agentId);
    },
    [removeAgent],
  );
}

/** Imperative version (for use outside React components, e.g., hotkeys) */
export function deleteAgentImperative(agentId: string): void {
  trpcMutate("agents.stop", { id: agentId }).catch(() => {});
  trpcMutate("agents.delete", { id: agentId }).catch(() => {});
  useAgentStore.getState().removeAgent(agentId);
  useWorkspaceStore.getState().releaseAgent(agentId);
}
