import { trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";
import { useWorkspaceStore } from "../stores/workspace";

const stops = new Map<string, Promise<unknown>>();

/** Resolves once a close's stop of this session is done (at once when none is running) */
export function pendingStop(agentId: string): Promise<unknown> {
  return stops.get(agentId) ?? Promise.resolve();
}

/** Close a session: gone from the store and its panes now; stopped, then deleted, in main
 *  (Stop reads the session before the delete removes it) */
export function deleteAgent(agentId: string): void {
  useAgentStore.getState().removeAgent(agentId);
  useWorkspaceStore.getState().releaseAgent(agentId);
  const stop = trpcMutate("agents.stop", { id: agentId })
    .catch(() => {})
    .finally(() => {
      if (stops.get(agentId) === stop) stops.delete(agentId);
    });
  stops.set(agentId, stop);
  stop.then(() => trpcMutate("agents.delete", { id: agentId })).catch(() => {});
}
