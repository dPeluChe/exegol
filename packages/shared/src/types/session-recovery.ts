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

/** Until recovery ends, a session not reattached yet has no PTY to answer for it */
export function isSessionReconnecting(
  state: SessionRecoveryState | undefined,
  agentId: string,
): boolean {
  if (!state || state.done) return false;
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
