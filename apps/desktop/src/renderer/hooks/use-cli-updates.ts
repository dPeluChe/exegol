import { type CliUpdateStatus, isNewerVersion, LIVE_STATUSES } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { suspendAgent } from "../lib/session-quiet";
import { runCommandInNewTab } from "../lib/spawn-shell";
import { trpcInvoke } from "../lib/trpc-client";
import {
  type AgentState,
  findAgentPane,
  isLiveAgent,
  showProject,
  useAgentStore,
} from "../stores/agents";
import { useCliRestartStore } from "../stores/cli-restarts";
import { toastError, useToastStore } from "../stores/toasts";
import { useResumeAgent } from "./use-resume-agent";

const CHECK_MS = 10 * 60 * 1000;
/** While an update runs in a tab: how soon its new version is noticed (a --version per CLI,
 *  cached by the binary's mtime; the newest-release part stays cached in main) */
const AWAIT_MS = 15_000;

/** Installed and newest version of each CLI with a live session (main caches the network part) */
export function useCliUpdates(): Map<string, CliUpdateStatus> {
  const awaiting = useCliRestartStore((s) => Object.values(s.pending).includes("update"));
  const agents = useAgentStore((s) => s.agents);
  const cliTypes = useMemo(
    () =>
      [
        ...new Set(
          Object.values(agents)
            .filter(isLiveAgent)
            .map((a) => a.cliType),
        ),
      ].sort(),
    [agents],
  );
  const { data } = useQuery({
    queryKey: ["cliUpdates", cliTypes],
    queryFn: () => trpcInvoke<CliUpdateStatus[]>("doctor.cliUpdates", { cliTypes }),
    enabled: cliTypes.length > 0,
    refetchInterval: awaiting ? AWAIT_MS : CHECK_MS,
    // An update started before switching apps restarts its sessions without waiting for focus
    refetchIntervalInBackground: awaiting,
    staleTime: CHECK_MS / 2,
  });
  return useMemo(() => new Map((data ?? []).map((s) => [s.cliType, s])), [data]);
}

/** A newer CLI than the one this session started with is installed. A session from before the
 *  version was recorded (0.5.10) has none: it is behind when the binary was written after it
 *  started (a minute of slack: launching right after an install is not "older") */
export function restartNeeded(
  agent: { cliVersion?: string | null; startedAt?: number | null },
  status?: CliUpdateStatus,
): boolean {
  if (!status) return false;
  if (agent.cliVersion) return isNewerVersion(status.installed, agent.cliVersion);
  return (
    !!status.installedAt &&
    !!agent.startedAt &&
    status.installedAt > agent.startedAt * 1000 + 60_000
  );
}

/** Run the update commands in one visible tab and restart these sessions once the new version is
 *  installed and each is free. `;` so one failed update does not skip the others */
export function updateAndRestart(projectId: string, commands: string[], agentIds: string[]) {
  const restarts = useCliRestartStore.getState();
  for (const id of agentIds) restarts.request(id, "update");
  showProject(projectId);
  return runCommandInNewTab(projectId, [...new Set(commands)].join(" ; "));
}

/** Free to restart: not in the middle of a turn */
const busy = (a: AgentState) => a.status === "running" || a.status === "spawning";

/** Restart the requested sessions once each is free: stop it quietly and resume the same
 *  conversation in its pane (the Suspend + Resume path). Mounted once, in App */
export function useCliRestarts(): void {
  const pending = useCliRestartStore((s) => s.pending);
  const agents = useAgentStore((s) => s.agents);
  const statuses = useCliUpdates();
  const { resume } = useResumeAgent();

  useEffect(() => {
    for (const id of Object.keys(pending)) {
      const agent = agents[id];
      if (!agent) {
        useCliRestartStore.getState().cancel(id);
        continue;
      }
      const when = pending[id];
      if (when === "update" && !restartNeeded(agent, statuses.get(agent.cliType))) continue;
      if (busy(agent) && when !== "now") continue;
      useCliRestartStore.getState().cancel(id);
      const pane = findAgentPane(agent.id, agent.projectId)?.paneId;
      // Said out loud: it happens away from the click (after the turn), or nothing seemed to
      useToastStore.getState().addToast({
        type: "info",
        title: `Restarting ${agent.alias ?? agent.cliType} on the new version`,
        agentId: agent.id,
      });
      void (async () => {
        if (LIVE_STATUSES.has(agent.status)) await suspendAgent(agent.id);
        await resume(agent, pane);
      })().catch(toastError(`${agent.alias ?? agent.cliType} did not restart`));
    }
  }, [pending, agents, statuses, resume]);
}
