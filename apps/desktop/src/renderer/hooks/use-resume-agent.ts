import type { Agent, AgentProvider } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { findAgentPane, toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { useWatchStore } from "../stores/watch";
import { useWorkspaceStore } from "../stores/workspace";
import { useSpawnAgent } from "./use-trpc";

/** CLI types that support session resume (from the provider registry) */
function useResumableCliTypes(): Set<string> {
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 60_000,
  });
  return useMemo(
    () => new Set((providers ?? []).filter((p) => p.capabilities?.supportsResume).map((p) => p.id)),
    [providers],
  );
}

export type ResumeSource = Pick<
  Agent,
  "id" | "projectId" | "cliType" | "taskDescription" | "branchName"
> & { accessMode?: Agent["accessMode"] | null };

/**
 * Resume (or re-launch) an ended agent as a new row that takes its place: in
 * its pane when it has one, in the watch list, and in the store. Shared by the
 * pane's scrollback view and the Dashboard, which has no pane to hand.
 */
export function useResumeAgent() {
  const spawnAgent = useSpawnAgent();
  const resumableCliTypes = useResumableCliTypes();

  const resume = useCallback(
    async (agent: ResumeSource, paneId?: string) => {
      const canResume = resumableCliTypes.has(agent.cliType);
      const newAgent = await spawnAgent.mutateAsync({
        projectId: agent.projectId,
        cliType: agent.cliType,
        taskDescription: agent.taskDescription,
        useWorktree: !!agent.branchName,
        branchName: agent.branchName ?? undefined,
        accessMode: agent.accessMode ?? undefined,
        resumeSession: canResume,
        resumeFromAgentId: canResume ? agent.id : undefined,
      });
      if (!newAgent?.id) return;

      const pane = paneId ?? findAgentPane(agent.id, agent.projectId)?.paneId;
      useWatchStore.getState().replaceAgent(agent.id, newAgent.id);
      const agents = useAgentStore.getState();
      agents.removeAgent(agent.id);
      trpcMutate("agents.delete", { id: agent.id }).catch(() => {});
      agents.addAgent(toAgentState(newAgent, { activityLevel: "busy" }));
      useTerminalStore.getState().createTerminal(newAgent.id);
      if (pane) {
        useWorkspaceStore.getState().updatePane(pane, { type: "terminal", agentId: newAgent.id });
      }
    },
    [resumableCliTypes, spawnAgent],
  );

  return { resume, pending: spawnAgent.isPending, resumableCliTypes };
}
