import { whenRecovered } from "../terminal/reattach-gate";
import type { LostSession } from "./auto-resume";

/**
 * Sessions a restart took with it: the sidecar came back empty (reboot, kill, version bump), so
 * every live agent was marked crashed at once. The renderer resumes the recent ones, staggered.
 */
let lost: LostSession[] = [];

export function setLostOnRestart(sessions: LostSession[]): void {
  lost = sessions;
}

/** Once: a second window or a reload must not resume them again */
export async function takeLostOnRestart(): Promise<LostSession[]> {
  await whenRecovered();
  const sessions = lost;
  lost = [];
  return sessions;
}
