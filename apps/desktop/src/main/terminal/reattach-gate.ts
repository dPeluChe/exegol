/**
 * Per-session readiness during the startup reattach. A pane's snapshot waited for every session
 * (4.2s with 8: each replays up to 8 MB of history into the emulator, one at a time); now it waits
 * only for its own, so a shell shows at once and each agent as soon as it is back.
 */
type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const waiters = new Map<string, Deferred>();
/** Resolved once the list of sessions to reattach is known (or recovery ended without one) */
const planned = deferred();

export function expectReattach(ids: string[]): void {
  for (const id of ids) waiters.set(id, deferred());
  planned.resolve();
}

export function settleReattach(id: string): void {
  waiters.get(id)?.resolve();
  waiters.delete(id);
}

/** Recovery finished (or failed): nothing is waited on any longer */
export function settleAllReattach(): void {
  for (const id of [...waiters.keys()]) settleReattach(id);
  planned.resolve();
}

export async function whenSessionReady(id: string, timeoutMs = 15_000): Promise<void> {
  const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs));
  await Promise.race([planned.promise, timeout]);
  const waiter = waiters.get(id);
  if (waiter) await Promise.race([waiter.promise, timeout]);
}
