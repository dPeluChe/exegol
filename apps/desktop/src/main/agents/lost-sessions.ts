import { whenRecovered } from "../terminal/reattach-gate";

/**
 * Sessions a restart took with it: the sidecar came back empty (reboot, or it was killed), so
 * every live agent was marked crashed at once. The renderer resumes them into their panes once.
 */
let lost: string[] = [];

export function setLostOnRestart(ids: string[]): void {
  lost = ids;
}

/** Once: a second window or a reload must not resume them again */
export async function takeLostOnRestart(): Promise<string[]> {
  await whenRecovered();
  const ids = lost;
  lost = [];
  return ids;
}
