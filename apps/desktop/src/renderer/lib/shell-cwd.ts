import { useAgentStore } from "../stores/agents";
import { trpcMutate } from "./trpc-client";

const saved = new Map<string, string>();
const PRUNE_AT = 64;

/** A shell's OSC 7 folder goes to its row, so a resume reopens there (an agent CLI's output
 *  could print one: shells only) */
export function persistShellCwd(agentId: string, cwd: string): void {
  const agents = useAgentStore.getState().agents;
  if (agents[agentId]?.cliType !== "shell") return;
  if (saved.get(agentId) === cwd) return;
  // One entry per shell ever opened otherwise: drop closed ones now and then
  if (saved.size >= PRUNE_AT) for (const id of saved.keys()) if (!agents[id]) saved.delete(id);
  saved.set(agentId, cwd);
  trpcMutate("agents.setShellCwd", { id: agentId, cwd }).catch(() => saved.delete(agentId));
}
