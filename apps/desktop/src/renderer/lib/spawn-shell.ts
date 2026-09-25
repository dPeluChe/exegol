import type { Agent } from "@exegol/shared";
import { toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { useWorkspaceStore } from "../stores/workspace";
import { trpcMutate } from "./trpc-client";

/** Start a shell in the project's folder (or `cwd` inside it) and show it in `paneId` */
export async function spawnShellIntoPane(
  projectId: string,
  paneId: string,
  taskDescription = "Terminal",
  /** Start folder inside the project (the launcher's "run in" chips) */
  cwd?: string,
): Promise<string> {
  const agent = await trpcMutate<Agent>("agents.spawn", {
    projectId,
    cliType: "shell",
    taskDescription,
    ...(cwd ? { cwdOverride: cwd } : {}),
  });
  useAgentStore.getState().addAgent(toAgentState(agent, { activityLevel: "busy" }));
  useTerminalStore.getState().createTerminal(agent.id);
  useWorkspaceStore.getState().updatePane(paneId, { type: "terminal", agentId: agent.id });
  return agent.id;
}
