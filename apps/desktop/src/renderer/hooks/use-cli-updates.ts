import {
  type CliInstallCopy,
  type CliInstallInfo,
  type CliUpdateStatus,
  cliRestartNeeded,
  LIVE_STATUSES,
  type Project,
} from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { sessionWhere } from "../lib/agent-label";
import { queryClient } from "../lib/query-client";
import { suspendAgent } from "../lib/session-quiet";
import { runCommandBeside, runCommandInNewTab } from "../lib/spawn-shell";
import { trpcInvoke } from "../lib/trpc-client";
import {
  type AgentState,
  findAgentPane,
  isLiveAgent,
  isWorking,
  showProject,
  useAgentStore,
} from "../stores/agents";
import { useAppStore } from "../stores/app";
import { restartOrder, updateGaveUp, useCliRestartStore } from "../stores/cli-restarts";
import { useCliSelfUpdateStore } from "../stores/cli-self-updates";
import { toastError, useToastStore } from "../stores/toasts";
import { selectFocusedAgentId, useWorkspaceStore } from "../stores/workspace";
import { useLatest } from "./use-latest";
import { useMountEffect } from "./use-mount-effect";
import { useEnabledProviders } from "./use-providers";
import { markResuming, useResumeAgent } from "./use-resume-agent";

const CHECK_MS = 10 * 60 * 1000;
/** While an update runs in a tab: how soon its new version is noticed (a --version per CLI,
 *  cached by the binary's mtime; the newest-release part stays cached in main) */
const AWAIT_MS = 15_000;

/** Installed and newest version of each CLI with a live session (main caches the network part) */
export function useCliUpdates(): Map<string, CliUpdateStatus> {
  const awaiting = useCliRestartStore((s) => Object.values(s.pending).includes("update"));
  // A string: every card and toolbar re-renders only when the set of live CLIs changes
  const cliKey = useAgentStore((s) =>
    [
      ...new Set(
        Object.values(s.agents)
          .filter(isLiveAgent)
          .map((a) => a.cliType),
      ),
    ]
      .sort()
      .join(","),
  );
  const cliTypes = useMemo(() => (cliKey ? cliKey.split(",") : []), [cliKey]);
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

/** Run the update commands in one visible shell and restart these sessions once the new version
 *  is installed and each is free. `;` so one failed update does not skip the others. From a
 *  session's toolbar (`sourceId`) the shell is beside it, or its own shell when its CLI was typed
 *  there and exited; else a new tab */
export async function updateAndRestart(
  projectId: string,
  commands: string[],
  agentIds: string[],
  sourceId?: string,
): Promise<void> {
  const agents = useAgentStore.getState().agents;
  // A CLI typed in a shell restarts by Continue there: Suspend + Resume would replace the shell
  const restartIds = agentIds.filter((id) => !agents[id]?.launchedInShell);
  const restarts = useCliRestartStore.getState();
  for (const id of restartIds) restarts.request(id, "update");
  restarts.watchUpdate(restartIds, null);
  showProject(projectId);
  const cmd = [...new Set(commands)].join(" ; ");
  const source = sourceId ? agents[sourceId] : undefined;
  if (source?.launchedInShell && source.status === "idle") {
    window.api.terminal.write(source.id, `${cmd}\n`);
    return;
  }
  const at = source?.projectId === projectId ? findAgentPane(source.id, projectId) : null;
  const shellId = at
    ? await runCommandBeside(projectId, at.tabId, at.paneId, cmd)
    : await runCommandInNewTab(projectId, cmd);
  restarts.watchUpdate(restartIds, shellId);
}

function focusedSessionId(): string | null {
  const projectId = useAppStore.getState().activeProjectId;
  return selectFocusedAgentId(useWorkspaceStore.getState(), projectId) ?? null;
}

/** A restart happens away from the session, often in another project: its toast says where */
function sessionAndProject(a: AgentState): string {
  return sessionWhere(a, queryClient.getQueryData<Project[]>(["projects"]) ?? []);
}

/** Sessions already said to be waiting for their turn to end: one toast per request */
const toldWaiting = new Set<string>();

/** Restart the requested sessions once each is free: stop it quietly and resume the same
 *  conversation in its pane (the Suspend + Resume path). Mounted once, in App */
export function useCliRestarts(): void {
  const pending = useCliRestartStore((s) => s.pending);
  const updates = useCliRestartStore((s) => s.updates);
  const agents = useAgentStore((s) => s.agents);
  const statuses = useCliUpdates();
  const { resume } = useResumeAgent();
  // While an update is awaited, look again now and then: its give-up time passes with no event
  const [now, setNow] = useState(Date.now);
  const awaiting = Object.values(pending).includes("update");
  useEffect(() => {
    if (!awaiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), AWAIT_MS);
    return () => window.clearInterval(timer);
  }, [awaiting]);

  useEffect(() => {
    for (const id of toldWaiting) if (!(id in pending)) toldWaiting.delete(id);
    if (Object.keys(pending).length === 0) return;
    const restarts = useCliRestartStore.getState();
    const ids = restartOrder(
      Object.keys(pending),
      (id) => agents[id]?.projectId,
      focusedSessionId(),
      useAppStore.getState().activeProjectId,
    );
    for (const id of ids) {
      const agent = agents[id];
      if (!agent) {
        restarts.cancel(id);
        continue;
      }
      const when = pending[id];
      if (when === "update" && !cliRestartNeeded(agent, statuses.get(agent.cliType))) {
        const run = updates[id];
        const shell = run?.shellId ? agents[run.shellId] : undefined;
        const shellLive = !!shell && LIVE_STATUSES.has(shell.status);
        if (run?.shellId && run.shellEndedAt === undefined && !shellLive) {
          restarts.shellEnded(id, Date.now());
          void queryClient.invalidateQueries({ queryKey: ["cliUpdates"] });
        } else if (updateGaveUp(run, now)) {
          restarts.cancel(id);
          useToastStore.getState().addToast({
            type: "info",
            title: `${sessionAndProject(agent)}: update finished without a newer version, restart cancelled`,
            agentId: agent.id,
          });
        }
        continue;
      }
      if (isWorking(agent) && when !== "now") {
        if (!toldWaiting.has(id)) {
          toldWaiting.add(id);
          useToastStore.getState().addToast({
            type: "info",
            title: `${sessionAndProject(agent)} is mid-turn: it restarts when free`,
            agentId: agent.id,
          });
        }
        continue;
      }
      restarts.cancel(id);
      const pane = findAgentPane(agent.id, agent.projectId)?.paneId;
      // Said out loud: it happens away from the click (after the turn), or nothing seemed to
      useToastStore.getState().addToast({
        type: "info",
        title: `Restarting ${sessionAndProject(agent)}`,
        agentId: agent.id,
      });
      // Held from the suspend on: the ended pane must not offer to replace it meanwhile
      markResuming([agent.id], true);
      void (async () => {
        if (LIVE_STATUSES.has(agent.status)) await suspendAgent(agent.id);
        await resume(agent, pane);
      })()
        .catch(toastError(`${sessionAndProject(agent)} did not restart`))
        .finally(() => markResuming([agent.id], false));
    }
  }, [pending, updates, agents, statuses, resume, now]);
}

/** The Commander asked for a session on the newer CLI: the same restart as the toolbar's */
export function useCommanderRestarts(): void {
  useMountEffect(() =>
    window.api.onCommanderRestart(({ agentId }) => useCliRestartStore.getState().request(agentId)),
  );
}

/** Every copy of each installed CLI on PATH (first = the one that runs): Settings > CLIs and the
 *  launcher's duplicate badge. One `which -a` per CLI, versions cached in main */
export function useCliInstalls(): Map<string, CliInstallCopy[]> {
  const { data } = useQuery({
    queryKey: ["cliInstalls"],
    queryFn: () => trpcInvoke<CliInstallInfo[]>("doctor.cliInstalls"),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => new Map((data ?? []).map((i) => [i.cliType, i.copies])), [data]);
}

/** "Codex updated to 0.162.1": what an ended session says when its CLI updated itself */
export const selfUpdateTitle = (cliName: string, to: string) => `${cliName} updated to ${to}`;

/** A CLI updated itself and exited (codex: "Please restart Codex"): mark the session as updated
 *  (its pane offers Restart session instead of a plain end) and offer the restart in a toast.
 *  No auto-restart setting exists, so it is one click. Mounted once, in App */
export function useCliSelfUpdates(): void {
  const providers = useEnabledProviders();
  const { resume } = useResumeAgent();
  const latest = useLatest({ providers, resume });

  useMountEffect(() =>
    window.api.onCliSelfUpdated((update) => {
      useCliSelfUpdateStore.getState().add(update);
      // The installed version moved: the notice, the toolbar and Settings read it again
      void queryClient.invalidateQueries({ queryKey: ["cliUpdates"] });
      void queryClient.invalidateQueries({ queryKey: ["cliInstalls"] });
      const agent = useAgentStore.getState().agents[update.agentId];
      if (!agent) return;
      const name = latest.current.providers.find((p) => p.id === update.cliType)?.name;
      useToastStore.getState().addToast({
        type: "success",
        title: selfUpdateTitle(name ?? update.cliType, update.to),
        body: `${agent.alias ?? update.cliType} ended to finish the update`,
        agentId: agent.id,
        durationMs: 15_000,
        action: {
          label: "Restart session",
          run: () => {
            const pane = findAgentPane(agent.id, agent.projectId)?.paneId;
            latest.current
              .resume(agent, pane)
              .catch(toastError(`${sessionAndProject(agent)} did not restart`));
          },
        },
      });
    }),
  );
}
