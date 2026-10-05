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
const recovered = deferred();
/** Not started yet; a session a pane waits on (mounted in the active tab) goes first */
const urgent: string[] = [];
let queue: string[] = [];
const wanted = new Set<string>();
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
  urgent.push(...ids.filter((id) => wanted.has(id)));
  queue = ids.filter((id) => !wanted.has(id));
  state.planned = [...ids];
  planned.resolve();
  publish();
}

/** The next session the reattach pool should take */
export function nextReattach(): string | undefined {
  return urgent.shift() ?? queue.shift();
}

function prioritize(id: string): void {
  if (!state.planned) {
    wanted.add(id);
    return;
  }
  const i = queue.indexOf(id);
  if (i < 0) return;
  queue.splice(i, 1);
  urgent.push(id);
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
  urgent.length = 0;
  queue = [];
  planned.resolve();
  recovered.resolve();
  state.done = true;
  state.crashed = [...crashed];
  publish();
}

/** Startup recovery is over: the one "recovery done" signal */
export function whenRecovered(): Promise<void> {
  return recovered.promise;
}

export async function whenSessionReady(id: string): Promise<void> {
  // Before awaiting: the pool takes its first sessions as soon as the plan is set
  if (!state.done) prioritize(id);
  await planned.promise;
  await waiters.get(id)?.promise;
}
