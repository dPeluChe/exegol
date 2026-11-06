import type { AgentBrowserPaneState, NeedsUserKind } from "@exegol/shared";

/** How long after its last action an agent still shows as using the pane */
const ACTIVE_WINDOW_MS = 15_000;
/** How long a driver keeps a pane after its last write: agents think between actions */
const LEASE_MS = 60_000;

/** agentId is the driver, set by a write, an open or a wait. A read only leaves seenAt */
interface PaneControl {
  paneId: string;
  projectId: string;
  agentId: string | null;
  alias: string | null;
  lastActionAt: number | null;
  seenAt: number | null;
  /** The last agent to use the pane in any way: it hears of a hand-back */
  seenBy: string | null;
  leaseUntil: number;
  openedBy: string | null;
  userHasControl: boolean;
  waiting: { agentId: string; reason: string; deadline: number } | null;
  needsUser: { host: string; kind: NeedsUserKind } | null;
  /** The user touched the page needsUser flagged: a trusted input event, which a page cannot forge */
  userOnLogin: boolean;
  /** Bumped on every hand-back, so a long poll can tell it happened while it slept */
  handBacks: number;
}

export type WakeReason = "handed_back" | "pane_closed" | "timeout";
type Listener = (state: AgentBrowserPaneState) => void;

const panes = new Map<string, PaneControl>();
const lastSeen = new Map<string, string>();
const waiters = new Map<string, Set<(r: WakeReason) => void>>();
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
      seenAt: null,
      seenBy: null,
      leaseUntil: 0,
      openedBy: null,
      userHasControl: false,
      waiting: null,
      needsUser: null,
      userOnLogin: false,
      handBacks: 0,
    };
    panes.set(paneId, p);
  }
  return p;
}

function toPaneState(p: PaneControl, now = Date.now()): AgentBrowserPaneState {
  const recent = p.lastActionAt !== null && now - p.lastActionAt < ACTIVE_WINDOW_MS;
  return {
    paneId: p.paneId,
    projectId: p.projectId,
    agentId: p.agentId,
    alias: p.alias,
    active: !!p.agentId && (recent || !!p.waiting || !!p.needsUser),
    lastActionAt: p.lastActionAt,
    userHasControl: p.userHasControl,
    waitingReason: p.waiting?.reason ?? null,
    needsUserHost: p.needsUser?.host ?? null,
    needsUserKind: p.needsUser?.kind ?? null,
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

/** An agent used the pane in the last few seconds and it was not handed to the user. A page that
 *  looks like a login hands over nothing until the user touches it: any page can show one, and
 *  the network guard applies only while this is true */
export function isAgentActing(paneId: string, now = Date.now()): boolean {
  const p = panes.get(paneId);
  if (!p || p.userHasControl || p.waiting || p.userOnLogin) return false;
  return p.seenAt !== null && now - p.seenAt < ACTIVE_WINDOW_MS;
}

export function noteUserGesture(paneId: string): void {
  const p = panes.get(paneId);
  if (p?.needsUser) p.userOnLogin = true;
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
  const now = Date.now();
  p.agentId = agent.id;
  p.alias = agent.alias;
  p.lastActionAt = now;
  p.seenAt = now;
  p.seenBy = agent.id;
  p.leaseUntil = now + LEASE_MS;
  lastSeen.set(agent.id, paneId);
  emit(p);
  scheduleExpiry(p);
}

/** A driver reading keeps its pane; anyone else passes through without becoming the driver */
export function noteAgentRead(paneId: string, projectId: string, agentId: string): void {
  const p = ensure(paneId, projectId);
  const now = Date.now();
  p.seenAt = now;
  p.seenBy = agentId;
  lastSeen.set(agentId, paneId);
  if (p.agentId !== agentId) return;
  const quiet = !toPaneState(p, now).active;
  p.lastActionAt = now;
  p.leaseUntil = now + LEASE_MS;
  if (quiet) emit(p);
  scheduleExpiry(p);
}

/** The alias of the other agent driving this pane, if any */
export function heldByOther(paneId: string, agentId: string, now = Date.now()): string | null {
  const p = panes.get(paneId);
  if (!p?.agentId || p.agentId === agentId) return null;
  const waiting = !!p.waiting && now < p.waiting.deadline;
  return waiting || now < p.leaseUntil ? (p.alias ?? p.agentId) : null;
}

export function markOpenedBy(paneId: string, projectId: string, agentId: string): void {
  ensure(paneId, projectId).openedBy = agentId;
}

/** The pane an agent last used in any way, for the default of a tool call */
export function lastSeenPane(agentId: string, paneIds: readonly string[]): string | null {
  const id = lastSeen.get(agentId);
  return id && paneIds.includes(id) ? id : null;
}

/** The last pane this agent drove, the only kind browser_open may reuse unasked */
export function lastPaneOf(agentId: string, paneIds: readonly string[]): string | null {
  let best: PaneControl | null = null;
  for (const id of paneIds) {
    const p = panes.get(id);
    if (p?.agentId === agentId && (best?.lastActionAt ?? 0) <= (p.lastActionAt ?? 0)) best = p;
  }
  return best?.paneId ?? null;
}

export function setNeedsUser(
  paneId: string,
  projectId: string,
  needs: { host: string; kind: NeedsUserKind } | null,
): void {
  const p = ensure(paneId, projectId);
  if (p.needsUser?.host === needs?.host && p.needsUser?.kind === needs?.kind) return;
  p.needsUser = needs;
  p.userOnLogin = false;
  emit(p);
}

export function takeOver(paneId: string): boolean {
  const p = panes.get(paneId);
  if (!p) return false;
  p.userHasControl = true;
  emit(p);
  return true;
}

function wake(paneId: string, reason: WakeReason): number {
  const set = waiters.get(paneId);
  waiters.delete(paneId);
  for (const fn of set ?? []) fn(reason);
  return set?.size ?? 0;
}

/** "Hand back" and "Done, hand back": the agent may drive again, and a waiting one wakes up.
 *  `woke` is false when no agent was waiting on it (the caller tells the agent another way) */
export function handBack(paneId: string): { agentId: string | null; woke: boolean } | null {
  const p = panes.get(paneId);
  if (!p) return null;
  const wasWaiting = !!p.waiting;
  p.userHasControl = false;
  p.needsUser = null;
  p.userOnLogin = false;
  p.waiting = null;
  p.handBacks += 1;
  // It waited for this pane: no other agent gets it in the moment before it wakes
  if (wasWaiting) p.leaseUntil = Date.now() + LEASE_MS;
  emit(p);
  const woken = wake(paneId, "handed_back");
  return { agentId: p.seenBy, woke: wasWaiting || woken > 0 };
}

export function startWaiting(
  paneId: string,
  projectId: string,
  agent: { id: string; alias: string | null },
  reason: string,
  deadline: number,
): void {
  const p = ensure(paneId, projectId);
  p.agentId = agent.id;
  p.alias = agent.alias;
  p.lastActionAt = Date.now();
  p.seenAt = p.lastActionAt;
  p.seenBy = agent.id;
  lastSeen.set(agent.id, paneId);
  p.waiting = { agentId: agent.id, reason, deadline };
  emit(p);
}

export function clearWaiting(paneId: string): void {
  const p = panes.get(paneId);
  if (!p?.waiting) return;
  p.waiting = null;
  emit(p);
  scheduleExpiry(p);
}

/** Resolves on a hand-back or the pane closing, or "timeout" when `ms` passes first */
export function waitForHandBack(paneId: string, ms: number): Promise<WakeReason> {
  return new Promise((resolve) => {
    const set = waiters.get(paneId) ?? new Set<(r: WakeReason) => void>();
    const done = (r: WakeReason) => {
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      set.delete(done);
      resolve("timeout");
    }, ms);
    set.add(done);
    waiters.set(paneId, set);
  });
}

/** The pane's webview is gone: the renderer drops it (and its alert), waiters wake */
export function forgetPane(paneId: string): void {
  const p = panes.get(paneId);
  const timer = expiry.get(paneId);
  if (timer) clearTimeout(timer);
  expiry.delete(paneId);
  panes.delete(paneId);
  wake(paneId, "pane_closed");
  if (p) {
    listener?.({
      ...toPaneState({ ...p, waiting: null, needsUser: null, userHasControl: false }),
      active: false,
      closed: true,
    });
  }
}

/** The agent exited: its waits and "needs you" flags go with it */
export function forgetAgentControl(agentId: string): void {
  lastSeen.delete(agentId);
  for (const p of panes.values()) {
    if (p.agentId === agentId) p.leaseUntil = 0;
    const waiting = p.waiting?.agentId === agentId;
    const flagged = p.seenBy === agentId && !!p.needsUser;
    if (!waiting && !flagged) continue;
    if (waiting) p.waiting = null;
    if (flagged) p.needsUser = null;
    emit(p);
  }
}
