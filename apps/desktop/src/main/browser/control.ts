import type { AgentBrowserPaneState } from "@exegol/shared";

/** How long after its last action an agent still shows as using the pane */
export const ACTIVE_WINDOW_MS = 15_000;

interface PaneControl {
  paneId: string;
  projectId: string;
  agentId: string | null;
  alias: string | null;
  lastActionAt: number | null;
  userHasControl: boolean;
  waiting: { agentId: string; reason: string; deadline: number } | null;
  needsUserHost: string | null;
  /** Bumped on every hand-back, so a long poll can tell it happened while it slept */
  handBacks: number;
}

type Listener = (state: AgentBrowserPaneState) => void;

const panes = new Map<string, PaneControl>();
const waiters = new Map<string, Set<() => void>>();
const expiry = new Map<string, ReturnType<typeof setTimeout>>();
let listener: Listener | null = null;

export function onBrowserControlChange(fn: Listener | null): void {
  listener = fn;
}

function ensure(paneId: string, projectId: string): PaneControl {
  let p = panes.get(paneId);
  if (!p || p.projectId !== projectId) {
    p = {
      paneId,
      projectId,
      agentId: null,
      alias: null,
      lastActionAt: null,
      userHasControl: false,
      waiting: null,
      needsUserHost: null,
      handBacks: 0,
    };
    panes.set(paneId, p);
  }
  return p;
}

export function toPaneState(p: PaneControl, now = Date.now()): AgentBrowserPaneState {
  const recent = p.lastActionAt !== null && now - p.lastActionAt < ACTIVE_WINDOW_MS;
  return {
    paneId: p.paneId,
    projectId: p.projectId,
    agentId: p.agentId,
    alias: p.alias,
    active: !!p.agentId && (recent || !!p.waiting || !!p.needsUserHost),
    lastActionAt: p.lastActionAt,
    userHasControl: p.userHasControl,
    waitingReason: p.waiting?.reason ?? null,
    needsUserHost: p.needsUserHost,
  };
}

function emit(p: PaneControl): void {
  listener?.(toPaneState(p));
}

/** The badge goes quiet ACTIVE_WINDOW_MS after the last action: one timer per pane */
function scheduleExpiry(p: PaneControl): void {
  const prev = expiry.get(p.paneId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    expiry.delete(p.paneId);
    if (panes.get(p.paneId) === p) emit(p);
  }, ACTIVE_WINDOW_MS + 100);
  timer.unref?.();
  expiry.set(p.paneId, timer);
}

export function getPaneControl(paneId: string): Readonly<PaneControl> | undefined {
  return panes.get(paneId);
}

export function listPaneStates(): AgentBrowserPaneState[] {
  const now = Date.now();
  return [...panes.values()].map((p) => toPaneState(p, now));
}

export function noteAgentAction(
  paneId: string,
  projectId: string,
  agent: { id: string; alias: string | null },
): void {
  const p = ensure(paneId, projectId);
  p.agentId = agent.id;
  p.alias = agent.alias;
  p.lastActionAt = Date.now();
  emit(p);
  scheduleExpiry(p);
}

/** The pane's last driver, for picking a default pane per agent */
export function lastPaneOf(agentId: string, paneIds: readonly string[]): string | null {
  let best: PaneControl | null = null;
  for (const id of paneIds) {
    const p = panes.get(id);
    if (p?.agentId === agentId && (best?.lastActionAt ?? 0) <= (p.lastActionAt ?? 0)) best = p;
  }
  return best?.paneId ?? null;
}

export function setNeedsUser(paneId: string, projectId: string, host: string | null): void {
  const p = ensure(paneId, projectId);
  if (p.needsUserHost === host) return;
  p.needsUserHost = host;
  emit(p);
}

export function takeOver(paneId: string): boolean {
  const p = panes.get(paneId);
  if (!p) return false;
  p.userHasControl = true;
  emit(p);
  return true;
}

/** "Hand back" and "Done, hand back": the agent may drive again, and a waiting one wakes up */
export function handBack(paneId: string): boolean {
  const p = panes.get(paneId);
  if (!p) return false;
  p.userHasControl = false;
  p.needsUserHost = null;
  p.waiting = null;
  p.handBacks += 1;
  emit(p);
  for (const wake of waiters.get(paneId) ?? []) wake();
  waiters.delete(paneId);
  return true;
}

export function startWaiting(
  paneId: string,
  projectId: string,
  agent: { id: string; alias: string | null },
  reason: string,
  deadline: number,
): { started: boolean } {
  const p = ensure(paneId, projectId);
  p.agentId = agent.id;
  p.alias = agent.alias;
  p.lastActionAt = Date.now();
  if (p.waiting?.agentId === agent.id) return { started: false };
  p.waiting = { agentId: agent.id, reason, deadline };
  emit(p);
  return { started: true };
}

export function clearWaiting(paneId: string): void {
  const p = panes.get(paneId);
  if (!p?.waiting) return;
  p.waiting = null;
  emit(p);
  scheduleExpiry(p);
}

/** Resolves true on a hand-back, false when `ms` passes first */
export function waitForHandBack(paneId: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const set = waiters.get(paneId) ?? new Set<() => void>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      set.delete(wake);
      resolve(false);
    }, ms);
    set.add(wake);
    waiters.set(paneId, set);
  });
}

/** Tests only */
export function resetBrowserControl(): void {
  for (const t of expiry.values()) clearTimeout(t);
  expiry.clear();
  panes.clear();
  waiters.clear();
}
