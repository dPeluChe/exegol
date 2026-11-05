import { compactDuration } from "@exegol/shared";

/** Running with no PTY output this long looks frozen (capped by the user's limit) */
export const FROZEN_MS = 10 * 60_000;

export interface StuckSession {
  id: string;
  cliType: string;
  muted: boolean;
  /** In a parallel run, or a pipeline/queue waits on its exit (they have their own timeout) */
  driven: boolean;
  /** Unix seconds */
  startedAt: number;
  /** ms */
  statusChangedAt: number | null;
}

export interface StuckContext {
  now: number;
  /** 0 = Off */
  limitMinutes: number;
  /** When main started watching output: before it, silence proves nothing */
  since: number;
  /** Last turn_started signal this run (a new prompt while already running) */
  turnStartedAt: (id: string) => number | undefined;
  msSinceOutput: (id: string) => number;
  /** Awaiting approval or a question on screen: the user's move, not a stuck turn */
  needsUser: (id: string) => boolean;
}

type StuckReason = "limit" | "no output";

export interface StuckVerdict {
  reason: StuckReason;
  /** Identifies the turn: one alert per value */
  turnStart: number;
  runningMs: number;
}

export function stuckVerdict(s: StuckSession, ctx: StuckContext): StuckVerdict | null {
  if (ctx.limitMinutes <= 0 || s.cliType === "shell" || s.driven || s.muted) return null;
  const turnStart = Math.max(s.statusChangedAt ?? s.startedAt * 1000, ctx.turnStartedAt(s.id) ?? 0);
  const runningMs = ctx.now - turnStart;
  const limitMs = ctx.limitMinutes * 60_000;
  const quietMs = Math.min(ctx.msSinceOutput(s.id), ctx.now - Math.max(turnStart, ctx.since));
  const reason: StuckReason | null =
    runningMs >= limitMs ? "limit" : quietMs >= Math.min(FROZEN_MS, limitMs) ? "no output" : null;
  // Checked last: it parses the screen
  if (!reason || ctx.needsUser(s.id)) return null;
  return { reason, turnStart, runningMs };
}

/** True the first time a turn is seen; a new turn (or status change) moves turnStart */
export function firstAlert(alerted: Map<string, number>, id: string, turnStart: number): boolean {
  if (alerted.get(id) === turnStart) return false;
  alerted.set(id, turnStart);
  return true;
}

export function stuckTitle(name: string, v: StuckVerdict): string {
  const took = compactDuration(v.runningMs);
  return v.reason === "limit"
    ? `${name} has been running for ${took}`
    : `${name} has shown no output for a while (running ${took})`;
}
