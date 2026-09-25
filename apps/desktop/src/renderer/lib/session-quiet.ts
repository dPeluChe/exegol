import { useAgentStore } from "../stores/agents";
import { trpcMutate } from "./trpc-client";

/** Mute: the session keeps running but leaves Needs attention and stops notifying */
export async function setAgentMuted(agentId: string, muted: boolean): Promise<void> {
  const store = useAgentStore.getState();
  store.updateAgent(agentId, { muted });
  if (muted) store.dismissAttention(agentId);
  await trpcMutate("agents.setMuted", { id: agentId, muted });
}

/**
 * Suspend: stop it quietly and keep it for Resume. The flag goes on first so
 * the stop's own status event does not land in Needs attention.
 */
export async function suspendAgent(agentId: string): Promise<void> {
  const store = useAgentStore.getState();
  store.updateAgent(agentId, { suspended: true });
  store.dismissAttention(agentId);
  await trpcMutate("agents.suspend", { id: agentId });
}
