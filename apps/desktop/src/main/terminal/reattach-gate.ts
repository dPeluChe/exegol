import type { SessionRecoveryState } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";

/**
 * Per-session readiness during the startup reattach. A pane's snapshot waited for every session
 * (4.2s with 8: each replays up to 8 MB of history into the emulator, one at a time); now it waits
 * only for its own, so a shell shows at once and each agent as soon as it is back.
 *
 * No timeout: recovery always ends in settleAllReattach (every sidecar RPC is bounded). A 15s
 * cap answered "no content" for the last sessions of a 17s reattach and their panes showed
 * "Failed to start" until the reattach landed.
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
const state: SessionRecoveryState = { done: false, planned: null, ready: [], crashed: [] };

function publish(): void {
  broadcast("recovery:progress", getRecoveryState());
}

export function getRecoveryState(): SessionRecoveryState {
  return {
    done: state.done,
    planned: state.planned && [...state.planned],
    ready: [...state.ready],
    crashed: [...state.crashed],
  };
}

export function expectReattach(ids: string[]): void {
  for (const id of ids) waiters.set(id, deferred());
  state.planned = [...ids];
  planned.resolve();
  publish();
}

export function settleReattach(id: string): void {
  const waiter = waiters.get(id);
  if (!waiter) return;
  waiter.resolve();
  waiters.delete(id);
  state.ready.push(id);
  publish();
}

/** Recovery finished (or failed): nothing is waited on any longer */
export function settleAllReattach(crashed: string[] = []): void {
  for (const [id, waiter] of waiters) {
    waiter.resolve();
    state.ready.push(id);
  }
  waiters.clear();
  planned.resolve();
  state.done = true;
  state.crashed = [...crashed];
  publish();
}

export async function whenSessionReady(id: string): Promise<void> {
  await planned.promise;
  await waiters.get(id)?.promise;
}
