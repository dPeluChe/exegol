import { classifyActivity, type SessionRecoveryState } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import type { AgentState } from "../stores/agents";
import { trpcInvoke } from "./trpc-client";

export const RECOVERY_KEY = ["recoveryState"];

/** Startup reattach progress; `recovery:progress` pushes keep it current (stores/agents) */
export const recoveryQuery = {
  queryKey: RECOVERY_KEY,
  queryFn: () => trpcInvoke<SessionRecoveryState>("agents.recoveryState"),
  staleTime: Number.POSITIVE_INFINITY,
};

export function useSessionRecovery(): SessionRecoveryState | undefined {
  return useQuery(recoveryQuery).data;
}

/**
 * The store listed these as live before the crash sweep ran. An agent turns crashed (its pane
 * shows the saved history); a shell leaves the store, and its pane reopens a fresh shell.
 */
export function applyRecoveredCrashes(
  agents: Record<string, AgentState>,
  crashed: string[],
): Record<string, AgentState> {
  let next = agents;
  for (const id of crashed) {
    const agent = next[id];
    if (!agent || agent.status === "crashed") continue;
    if (next === agents) next = { ...agents };
    if (agent.cliType === "shell") delete next[id];
    else {
      const activityLevel = classifyActivity("crashed", agent.currentStep, agent.cliType);
      next[id] = { ...agent, status: "crashed", activityLevel };
    }
  }
  return next;
}
