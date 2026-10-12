/** Last input per session (output is agent-messaging's lastOutputAt), and the throttled copy in
 *  agents.last_activity_at that the idle sweep reads after a restart. A leaf: PtyHost imports it */
const PERSIST_MS = 5 * 60_000;
const lastInputAt = new Map<string, number>();
const lastPersistedAt = new Map<string, number>();
let persist: ((agentId: string, at: number) => void) | null = null;

export function setActivityPersister(fn: (agentId: string, at: number) => void): void {
  persist = fn;
}

export function noteSessionActivity(agentId: string, kind: "input" | "output"): void {
  const now = Date.now();
  if (kind === "input") lastInputAt.set(agentId, now);
  if (!persist || now - (lastPersistedAt.get(agentId) ?? 0) < PERSIST_MS) return;
  lastPersistedAt.set(agentId, now);
  try {
    persist?.(agentId, now);
  } catch {
    /* DB closed during shutdown */
  }
}

export function lastInputOf(agentId: string): number | undefined {
  return lastInputAt.get(agentId);
}

export function pruneSessionActivity(live: ReadonlySet<string>): void {
  for (const map of [lastInputAt, lastPersistedAt]) {
    for (const id of map.keys()) if (!live.has(id)) map.delete(id);
  }
}
