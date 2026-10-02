import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { useWorkspaceStore } from "../stores/workspace";

/** Close a session: gone from the store and its panes now; stopped, then deleted, in main
 *  (Stop reads the session before the delete removes it) */
export function deleteAgent(agentId: string): void {
  useAgentStore.getState().removeAgent(agentId);
  useWorkspaceStore.getState().releaseAgent(agentId);
  trpcMutate("agents.stop", { id: agentId })
    .catch(() => {})
    .then(() => trpcMutate("agents.delete", { id: agentId }))
    .catch(() => {});
}
