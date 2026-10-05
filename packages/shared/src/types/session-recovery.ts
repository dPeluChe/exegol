/** Startup reattach progress, pushed by main on `recovery:progress` */
export interface SessionRecoveryState {
  done: boolean;
  /** Sessions being reattached; null until recovery knows the list */
  planned: string[] | null;
  /** Reattach finished for these (alive or not) */
  ready: string[];
  /** Marked crashed by the closing sweep (set once done) */
  crashed: string[];
}

export const RECOVERY_DONE: SessionRecoveryState = {
  done: true,
  planned: [],
  ready: [],
  crashed: [],
};

/** A planned session not reattached yet has no PTY to answer for it; one spawned during
 *  recovery is not in the plan and shows its normal start state */
export function isSessionReconnecting(
  state: SessionRecoveryState | undefined,
  agentId: string,
): boolean {
  if (!state || state.done) return false;
  if (state.planned && !state.planned.includes(agentId)) return false;
  return !state.ready.includes(agentId);
}

/** Sessions still waiting; null while the list is unknown, 0 once done */
export function reconnectingCount(state: SessionRecoveryState | undefined): number | null {
  if (!state || state.done) return 0;
  if (!state.planned) return null;
  const ready = new Set(state.ready);
  return state.planned.filter((id) => !ready.has(id)).length;
}

export function reconnectingLabel(state: SessionRecoveryState | undefined): string | null {
  if (!state || state.done) return null;
  const n = reconnectingCount(state);
  return n ? `Reconnecting ${n} session${n === 1 ? "" : "s"}...` : "Reconnecting sessions...";
}

/** What the user was looking at: the active tab's sessions (focused pane first) and its project */
export interface ActiveView {
  projectId: string | null;
  agentIds: string[];
}
