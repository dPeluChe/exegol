import { type CliUpdateStatus, isNewerVersion, LIVE_STATUSES } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { suspendAgent } from "../lib/session-quiet";
import { trpcInvoke } from "../lib/trpc-client";
import { type AgentState, findAgentPane, useAgentStore } from "../stores/agents";
import { useCliRestartStore } from "../stores/cli-restarts";
import { useResumeAgent } from "./use-resume-agent";

const CHECK_MS = 10 * 60 * 1000;

/** Installed and newest version of each CLI with a live session (main caches the network part) */
export function useCliUpdates(): Map<string, CliUpdateStatus> {
  const agents = useAgentStore((s) => s.agents);
  const cliTypes = useMemo(
    () =>
      [
        ...new Set(
          Object.values(agents)
            .filter((a) => a.cliType !== "shell" && LIVE_STATUSES.has(a.status))
            .map((a) => a.cliType),
        ),
      ].sort(),
    [agents],
  );
  const { data } = useQuery({
    queryKey: ["cliUpdates", cliTypes],
    queryFn: () => trpcInvoke<CliUpdateStatus[]>("doctor.cliUpdates", { cliTypes }),
    enabled: cliTypes.length > 0,
    refetchInterval: CHECK_MS,
    staleTime: CHECK_MS / 2,
  });
  return useMemo(() => new Map((data ?? []).map((s) => [s.cliType, s])), [data]);
}

/** A newer CLI than the one this session started with is installed */
export function restartNeeded(agent: Pick<AgentState, "cliVersion">, status?: CliUpdateStatus) {
  return isNewerVersion(status?.installed, agent.cliVersion);
}

/** Free to restart: not in the middle of a turn */
const busy = (a: AgentState) => a.status === "running" || a.status === "spawning";

/** Restart the requested sessions once each is free: stop it quietly and resume the same
 *  conversation in its pane (the Suspend + Resume path). Mounted once, in App */
export function useCliRestarts(): void {
  const pending = useCliRestartStore((s) => s.pending);
  const agents = useAgentStore((s) => s.agents);
  const { resume } = useResumeAgent();

  useEffect(() => {
    for (const id of Object.keys(pending)) {
      const agent = agents[id];
      if (!agent) {
        useCliRestartStore.getState().cancel(id);
        continue;
      }
      if (busy(agent) && pending[id] !== "now") continue;
      useCliRestartStore.getState().cancel(id);
      const pane = findAgentPane(agent.id, agent.projectId)?.paneId;
      void (async () => {
        if (LIVE_STATUSES.has(agent.status)) await suspendAgent(agent.id);
        await resume(agent, pane);
      })().catch((err) => console.error("[CliRestart] Restart failed:", err));
    }
  }, [pending, agents, resume]);
}
