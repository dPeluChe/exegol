import type { AgentActivityLevel, AgentStatus } from "@exegol/shared";

export const LONG_WAIT_SECONDS = 5 * 60;

interface Timed {
  status: AgentStatus;
  activityLevel: AgentActivityLevel;
  activitySince?: number;
}

export interface TurnTime {
  state: "working" | "waiting";
  seconds: number;
}

/** How long a session has been in its current turn (working) or waiting for you */
export function turnTime(a: Timed, now: number): TurnTime | null {
  if (a.activitySince === undefined || a.activityLevel === "neutral") return null;
  const seconds = Math.max(0, (now - a.activitySince) / 1000);
  return { state: a.activityLevel === "busy" ? "working" : "waiting", seconds };
}

export function isLongWait(a: Timed, now: number): boolean {
  const t = turnTime(a, now);
  return a.status === "waiting_input" && t?.state === "waiting" && t.seconds >= LONG_WAIT_SECONDS;
}

/** When a session's activity level started: kept while the level holds */
export function nextActivitySince(
  prev: { activityLevel: AgentActivityLevel; activitySince?: number } | undefined,
  level: AgentActivityLevel,
  now: number,
): number {
  if (prev && prev.activityLevel === level && prev.activitySince !== undefined) {
    return prev.activitySince;
  }
  return now;
}
