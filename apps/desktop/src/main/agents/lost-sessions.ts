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

/** Once: a second window or a reload must not resume them again */
export async function takeLostOnRestart(timeoutMs = 20_000): Promise<string[]> {
  await Promise.race([recovered, new Promise((r) => setTimeout(r, timeoutMs))]);
  const ids = lost;
  lost = [];
  return ids;
}
