import { whenRecovered } from "../terminal/reattach-gate";
import type { LostSession } from "./auto-resume";

/**
 * Sessions a restart took with it: the sidecar came back empty (reboot, kill, version bump), so
 * every live agent was marked crashed at once. Each stays here until it is resumed, kept
 * suspended or reported, so a renderer reload mid-stagger picks up the rest.
 */
let lost: LostSession[] = [];

export function setLostOnRestart(sessions: LostSession[]): void {
  lost = sessions;
}

/** A sidecar that stopped under the running app (lost-session-exit.ts) */
export function addLost(sessions: LostSession[]): void {
  const known = new Set(lost.map((s) => s.id));
  lost = [...lost, ...sessions.filter((s) => !known.has(s.id))];
}

/** The ones not settled yet */
export async function takeLostOnRestart(): Promise<LostSession[]> {
  await whenRecovered();
  return [...lost];
}

export function settleLost(ids: Iterable<string>): void {
  const done = new Set(ids);
  if (done.size > 0) lost = lost.filter((s) => !done.has(s.id));
}
