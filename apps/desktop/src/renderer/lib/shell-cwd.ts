import { useAgentStore } from "../stores/agents";
import { trpcMutate } from "./trpc-client";

const saved = new Map<string, string>();

/** A shell's OSC 7 folder goes to its row, so a resume reopens there (an agent CLI's output
 *  could print one: shells only) */
export function persistShellCwd(agentId: string, cwd: string): void {
  if (useAgentStore.getState().agents[agentId]?.cliType !== "shell") return;
  if (saved.get(agentId) === cwd) return;
  saved.set(agentId, cwd);
  trpcMutate("agents.setShellCwd", { id: agentId, cwd }).catch(() => saved.delete(agentId));
}
