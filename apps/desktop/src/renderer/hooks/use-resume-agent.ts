import type { Agent, AgentCreate, AgentProvider } from "@exegol/shared";
import { useCallback, useMemo } from "react";
import { create } from "zustand";
import {
  AUTO_RESUME_CONCURRENCY,
  AUTO_RESUME_SETTLE_MS,
  orderAutoResume,
  screenRank,
  staggered,
} from "../lib/auto-resume";
import { queryClient } from "../lib/query-client";
import { markSuspended } from "../lib/session-quiet";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { findAgentPane, jumpToAgent, toAgentState, useAgentStore } from "../stores/agents";
import { useTerminalStore } from "../stores/terminals";
import { toastError, useToastStore } from "../stores/toasts";
import { useWatchStore } from "../stores/watch";
import { type Pane, useWorkspaceStore } from "../stores/workspace";
import { pendingStop } from "./use-delete-agent";
import { useLatest } from "./use-latest";
import { useMountEffect } from "./use-mount-effect";
import { enabledProvidersQuery, isLaunchable, useEnabledProviders } from "./use-providers";
import { useSpawnAgent } from "./use-trpc";

/** CLI types that can resume a session here: the provider supports it and its CLI is installed
 *  (resuming one that is not ended in a preflight error instead of the install hint) */
export function resumableFrom(providers: AgentProvider[]): Set<string> {
  return new Set(
    providers.filter((p) => p.capabilities?.supportsResume && isLaunchable(p)).map((p) => p.id),
  );
}

function useResumableCliTypes(): Set<string> {
  const providers = useEnabledProviders();
  return useMemo(() => resumableFrom(providers), [providers]);
}

/** updatePane only reaches the active project: a pane in another project (auto-resume after a
 *  restart, the Dashboard) kept pointing at the old agent. False when that pane is gone */
export function setPaneIn(projectId: string, paneId: string, patch: Partial<Pane>): boolean {
  let written = false;
  useWorkspaceStore.setState((s) => {
    const pw = s.projectWorkspaces[projectId];
    const existing = pw?.panes[paneId];
    if (!pw || !existing) return s;
    written = true;
    const panes = { ...pw.panes, [paneId]: { ...existing, ...patch } };
    return { projectWorkspaces: { ...s.projectWorkspaces, [projectId]: { ...pw, panes } } };
  });
  return written;
}

function setPaneAgent(projectId: string, paneId: string, agentId: string): void {
  setPaneIn(projectId, paneId, { type: "terminal", agentId });
}

interface ResumingState {
  /** Sessions a resume, a restart or the lost-session pass is about to replace */
  ids: Record<string, true>;
  /** The lost-session pass is done: a crashed shell still here was not reopened */
  lostPassDone: boolean;
}

export const useResumingStore = create<ResumingState>(() => ({ ids: {}, lostPassDone: false }));

export function markResuming(ids: string[], on: boolean): void {
  useResumingStore.setState((s) => {
    const next = { ...s.ids };
    for (const id of ids) {
      if (on) next[id] = true;
      else delete next[id];
    }
    return { ids: next };
  });
}

/** A respawn is on its way for this session: its pane must not offer to replace it meanwhile */
export function resumeHeld(
  agent: { id: string; cliType: string; status: string },
  s: ResumingState = useResumingStore.getState(),
): boolean {
  if (s.ids[agent.id]) return true;
  return agent.cliType === "shell" && agent.status === "crashed" && !s.lostPassDone;
}

export const isResuming = (id: string) => !!useResumingStore.getState().ids[id];

/** Sessions being resumed now, and ones already resumed (their row is gone), across every
 *  caller: pane, card, restart onto an update */
const resuming = new Set<string>();
const resumed = new Set<string>();

/** Run `fn` once per session: two resumes of one Claude session started two processes on it
 *  (seen in a log, 20ms apart); one died and the pane could end up on the dead one */
export async function onceAtATime<T>(id: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (resuming.has(id) || resumed.has(id)) return undefined;
  resuming.add(id);
  markResuming([id], true);
  try {
    const result = await fn();
    resumed.add(id);
    return result;
  } finally {
    resuming.delete(id);
    markResuming([id], false);
  }
}

export type ResumeSource = Pick<
  Agent,
  "id" | "projectId" | "cliType" | "taskDescription" | "branchName"
> & { accessMode?: Agent["accessMode"] | null };

/** Whether each CLI can resume a session here, outside React (Reopen closed tab): the cached
 *  provider list when fresh, else read now */
export async function fetchResumableCliTypes(): Promise<Set<string>> {
  const providers = await queryClient
    .fetchQuery(enabledProvidersQuery)
    .catch(() => [] as AgentProvider[]);
  return resumableFrom(providers);
}

/** Resume (`canResume`) or re-launch `agent` as a new row that takes its place, in `paneId` or
 *  the pane that shows it. Resolves to the new row's id */
export function resumeSessionInto(
  agent: ResumeSource,
  canResume: boolean,
  spawn: (data: AgentCreate) => Promise<Agent>,
  paneId?: string,
  options: {
    /** The name the session keeps (a re-launch otherwise gets a new codename) */
    keepName?: string;
    /** Archive the old row instead of deleting it: its output stays readable */
    keepOld?: boolean;
  } = {},
): Promise<string | null> {
  const run = onceAtATime(agent.id, async () => {
    // A close's stop still running: resuming now ran two processes on one session
    await pendingStop(agent.id);
    const newAgent = await spawn({
      projectId: agent.projectId,
      cliType: agent.cliType,
      taskDescription: agent.taskDescription,
      useWorktree: !!agent.branchName,
      branchName: agent.branchName ?? undefined,
      accessMode: agent.accessMode ?? undefined,
      name: options.keepName,
      resumeSession: canResume,
      // Always the source: a re-launch (no resume) still inherits its YOLO choice
      resumeFromAgentId: agent.id,
    });
    if (!newAgent?.id) return null;

    const pane = paneId ?? findAgentPane(agent.id, agent.projectId)?.paneId;
    useWatchStore.getState().replaceAgent(agent.id, newAgent.id);
    const agents = useAgentStore.getState();
    agents.removeAgent(agent.id);
    trpcMutate(options.keepOld ? "agents.archive" : "agents.delete", { id: agent.id }).catch(
      () => {},
    );
    agents.addAgent(toAgentState(newAgent, { activityLevel: "busy" }));
    useTerminalStore.getState().createTerminal(newAgent.id);
    if (pane) setPaneAgent(agent.projectId, pane, newAgent.id);
    return newAgent.id;
  });
  return run.then((id) => id ?? null);
}

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
      resumeSessionInto(
        agent,
        resumableCliTypes.has(agent.cliType),
        spawnAgent.mutateAsync,
        paneId,
      ),
    [resumableCliTypes, spawnAgent],
  );

  return { resume, pending: spawnAgent.isPending, resumableCliTypes };
}

type LostAgent = Agent & { lastActiveAt: number };

interface KeptSession {
  agentId: string;
  projectId: string;
  projectName: string;
  name: string;
  cliType: string;
}

const KEPT_LINKS = 5;

/** The next resume waits for this CLI to be up (at its prompt), at most AUTO_RESUME_SETTLE_MS */
function settled(agentId: string, cliType: string): Promise<void> {
  if (cliType === "shell") return Promise.resolve();
  return new Promise((resolve) => {
    const isUp = () => {
      const a = useAgentStore.getState().agents[agentId];
      return !a || a.status === "waiting_input" || a.status === "idle";
    };
    if (isUp()) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const timer = setTimeout(done, AUTO_RESUME_SETTLE_MS);
    const unsub = useAgentStore.subscribe(() => {
      if (isUp()) done();
    });
  });
}

function showKept(kept: KeptSession[]): void {
  const store = useAgentStore.getState();
  for (const k of kept) {
    store.updateAgent(k.agentId, { status: "stopped" });
    markSuspended(k.agentId);
  }
  if (kept.length === 0) return;
  const more = kept.length - KEPT_LINKS;
  useToastStore.getState().addToast({
    type: "info",
    title: `${kept.length} session${kept.length === 1 ? "" : "s"} kept suspended (idle 3+ days)`,
    body: more > 0 ? `+${more} more` : undefined,
    durationMs: 30_000,
    links: kept.slice(0, KEPT_LINKS).map((k) => ({
      id: k.agentId,
      label: `${k.name} (${k.projectName})`,
      run: () => jumpToAgent(k.agentId, k.projectId),
    })),
  });
}

/** autoResumeReport's cut, applied here too */
const REASON_MAX = 120;

/**
 * After the sidecar took every session (at startup, or a stop under the running app pushed by
 * main): the ones active in the last 3 days come back in their panes, 3 at a time, on screen first
 * (main kept the rest suspended). Runs even with no resumable CLI: shells still come back.
 */
export function useAutoResumeLost(): void {
  const spawnAgent = useSpawnAgent();
  const latest = useLatest({ spawn: spawnAgent.mutateAsync });
  useMountEffect(() => {
    // One pass at a time: a stop while a pass runs queues one more (main keeps what is pending)
    let running = false;
    let again = false;
    const pass = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          useResumingStore.setState({ lostPassDone: false });
          await resumeLostOnce(latest.current.spawn);
        } while (again);
      } finally {
        running = false;
        useResumingStore.setState({ lostPassDone: true });
      }
    };
    void pass();
    return window.api.onSessionsLost(() => void pass());
  });
}

async function resumeLostOnce(spawn: (data: AgentCreate) => Promise<Agent>): Promise<void> {
  // Pins are commitments: never kept suspended, resumed first, even with no pane
  const pinned = new Set(useWatchStore.getState().watched);
  const lost = await trpcInvoke<{ resume: LostAgent[]; kept: KeptSession[] }>(
    "agents.takeLostOnRestart",
    { pinned: [...pinned] },
  ).catch(() => ({ resume: [], kept: [] }));
  showKept(lost.kept);
  if (lost.resume.length === 0) return;
  const resumable = await fetchResumableCliTypes();
  const started = Date.now();
  const ws = useWorkspaceStore.getState();
  const ordered = orderAutoResume(lost.resume, (a) =>
    screenRank(a.id, a.projectId, ws.projectWorkspaces, ws._activeProjectId, pinned),
  );
  // Queued ones too: their panes show "Resuming" instead of a launcher that could replace them
  const queued = ordered.map((a) => a.id);
  markResuming(queued, true);
  const outcomes: Array<{ id: string; cliType: string; outcome: string; reason?: string }> = [];
  await staggered(ordered, AUTO_RESUME_CONCURRENCY, async (agent) => {
    const pane = findAgentPane(agent.id, agent.projectId);
    const report = (outcome: string, reason?: string) =>
      outcomes.push({
        id: agent.id,
        cliType: agent.cliType,
        outcome,
        reason: reason?.slice(0, REASON_MAX),
      });
    if (!pane && !pinned.has(agent.id)) {
      // Main suspends it: Resume from the sidebar, not a crash
      useAgentStore.getState().updateAgent(agent.id, { status: "stopped" });
      markSuspended(agent.id);
      report("skipped", "no pane");
      return;
    }
    try {
      const canResume = resumable.has(agent.cliType);
      const newId = await resumeSessionInto(agent, canResume, spawn, pane?.paneId);
      if (!newId) {
        report("skipped", "already resuming");
        return;
      }
      report("resumed", canResume ? undefined : "fresh start");
      await settled(newId, agent.cliType);
    } catch (err) {
      report("failed", err instanceof Error ? err.message.split("\n")[0] : "spawn failed");
    }
  });
  markResuming(queued, false);
  trpcMutate("agents.autoResumeReport", {
    outcomes,
    totalMs: Date.now() - started,
    kept: lost.kept.length,
  }).catch(() => {});
}

/**
 * A "continue last" with no way to check first (no history adapter) found no session and the CLI
 * exited at once: relaunch it fresh in the same pane, once (main reports it once per spawn, and
 * the relaunch carries no resume flag), keeping its name, model, YOLO and access mode
 */
export function useRelaunchMissedResume(): void {
  const spawnAgent = useSpawnAgent();
  const providers = useEnabledProviders();
  const latest = useLatest({ spawn: spawnAgent.mutateAsync, providers });

  useMountEffect(() =>
    window.api.onResumeMissed(({ agentId, projectId, cliType }) => {
      const agent = useAgentStore.getState().agents[agentId];
      const pane = findAgentPane(agentId, projectId)?.paneId;
      // Closed, stopping, archived or only on the Dashboard: nobody is waiting on it
      if (!agent || !pane) return;
      const cli = latest.current.providers.find((p) => p.id === cliType)?.name ?? cliType;
      resumeSessionInto(agent, false, latest.current.spawn, pane, {
        keepName: agent.alias ?? undefined,
        keepOld: true,
      })
        .then(() => {
          // Still in the store: the relaunch did not happen and the failure stays on screen
          if (useAgentStore.getState().agents[agentId]) return;
          useToastStore.getState().addToast({
            type: "info",
            title: `No previous ${cli} session here, started a new one`,
          });
        })
        .catch(toastError(`${cli} did not start`));
    }),
  );
}
