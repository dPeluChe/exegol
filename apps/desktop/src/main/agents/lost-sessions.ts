/**
 * Sessions a restart took with it: the sidecar came back empty (reboot, or it was killed), so
 * every live agent was marked crashed at once. The renderer resumes them into their panes once.
 */
let lost: string[] = [];
let done: () => void = () => {};
const recovered = new Promise<void>((resolve) => {
  done = resolve;
});

export function setLostOnRestart(ids: string[]): void {
  lost = ids;
}

export function markRecoveryDone(): void {
  done();
}

/** Startup recovery (sidecar reattach) finished, or `timeoutMs` passed. Free once it is done */
export function whenRecovered(timeoutMs = 15_000): Promise<unknown> {
  return Promise.race([recovered, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Once: a second window or a reload must not resume them again */
export async function takeLostOnRestart(timeoutMs = 20_000): Promise<string[]> {
  await whenRecovered(timeoutMs);
  const ids = lost;
  lost = [];
  return ids;
}
