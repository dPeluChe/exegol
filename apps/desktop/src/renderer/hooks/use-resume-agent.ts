import type { Agent } from "@exegol/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { findAgentPane, toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { useWatchStore } from "../stores/watch";
import { useWorkspaceStore } from "../stores/workspace";
import { isLaunchable, useEnabledProviders } from "./use-providers";
import { useSpawnAgent } from "./use-trpc";

/** CLI types that can resume a session here: the provider supports it and its CLI is installed
 *  (resuming one that is not ended in a preflight error instead of the install hint) */
function useResumableCliTypes(): Set<string> {
  const providers = useEnabledProviders();
  return useMemo(
    () =>
      new Set(
        providers.filter((p) => p.capabilities?.supportsResume && isLaunchable(p)).map((p) => p.id),
      ),
    [providers],
  );
}

/** updatePane only reaches the active project: a pane in another project (auto-resume after a
 *  restart, the Dashboard) kept pointing at the old agent */
function setPaneAgent(projectId: string, paneId: string, agentId: string): void {
  useWorkspaceStore.setState((s) => {
    const pw = s.projectWorkspaces[projectId];
    const existing = pw?.panes[paneId];
    if (!pw || !existing) return s;
    const panes = { ...pw.panes, [paneId]: { ...existing, type: "terminal" as const, agentId } };
    return { projectWorkspaces: { ...s.projectWorkspaces, [projectId]: { ...pw, panes } } };
  });
}

/** Sessions being resumed now, and ones already resumed (their row is gone), across every
 *  caller: pane, card, restart onto an update */
const resuming = new Set<string>();
const resumed = new Set<string>();

/** Run `fn` once per session: two resumes of one Claude session started two processes on it
 *  (seen in a log, 20ms apart); one died and the pane could end up on the dead one */
export async function onceAtATime(id: string, fn: () => Promise<void>): Promise<void> {
  if (resuming.has(id) || resumed.has(id)) return;
  resuming.add(id);
  try {
    await fn();
    resumed.add(id);
  } finally {
    resuming.delete(id);
  }
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
    (agent: ResumeSource, paneId?: string) =>
      onceAtATime(agent.id, async () => {
        const canResume = resumableCliTypes.has(agent.cliType);
        const newAgent = await spawnAgent.mutateAsync({
          projectId: agent.projectId,
          cliType: agent.cliType,
          taskDescription: agent.taskDescription,
          useWorktree: !!agent.branchName,
          branchName: agent.branchName ?? undefined,
          accessMode: agent.accessMode ?? undefined,
          resumeSession: canResume,
          // Always the source: a re-launch (no resume) still inherits its YOLO choice
          resumeFromAgentId: agent.id,
        });
        if (!newAgent?.id) return;

        const pane = paneId ?? findAgentPane(agent.id, agent.projectId)?.paneId;
        useWatchStore.getState().replaceAgent(agent.id, newAgent.id);
        const agents = useAgentStore.getState();
        agents.removeAgent(agent.id);
        trpcMutate("agents.delete", { id: agent.id }).catch(() => {});
        agents.addAgent(toAgentState(newAgent, { activityLevel: "busy" }));
        useTerminalStore.getState().createTerminal(newAgent.id);
        if (pane) setPaneAgent(agent.projectId, pane, newAgent.id);
      }),
    [resumableCliTypes, spawnAgent],
  );

  return { resume, pending: spawnAgent.isPending, resumableCliTypes };
}

/**
 * After a restart took every session with the sidecar: resume each one into its pane, once,
 * so the terminals and agents are there again. Waits for the provider list (resume vs re-launch).
 */
export function useAutoResumeLost(): void {
  const { resume, resumableCliTypes } = useResumeAgent();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || resumableCliTypes.size === 0) return;
    ran.current = true;
    void (async () => {
      const lost = await trpcInvoke<Agent[]>("agents.takeLostOnRestart").catch(() => []);
      for (const agent of lost) {
        const pane = findAgentPane(agent.id, agent.projectId);
        // Sequential: a burst of CLIs starting at once is what the user just rebooted away from
        if (pane) await resume(agent, pane.paneId).catch(() => {});
      }
    })();
  }, [resumableCliTypes, resume]);
}
