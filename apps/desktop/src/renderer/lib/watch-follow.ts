// A Watching pin is a commitment to a session, not to an id: after any resume (in a pane, by
// auto-resume, by main, twice) it moves to the newest continuation main recorded, keeping its
// spot, open state and font. The card's key is the id, so its mirror remounts on the new PTY.
import { LIVE_STATUSES } from "@exegol/shared";
import { useAgentStore } from "../stores/agents";
import { type GoneSession, useWatchStore } from "../stores/watch";
import { trpcInvoke } from "./trpc-client";

export interface WatchResolution {
  id: string;
  latest: string;
  info: GoneSession | null;
}

const THROTTLE_MS = 1_000;

/** Pure: pins to move, and what to show for those with no live continuation */
export function planWatchFollow(
  results: WatchResolution[],
  isLiveInStore: (id: string) => boolean,
): { replace: Array<[string, string]>; gone: Record<string, GoneSession> } {
  const replace: Array<[string, string]> = [];
  const gone: Record<string, GoneSession> = {};
  for (const r of results) {
    if (r.latest !== r.id) replace.push([r.id, r.latest]);
    if (!isLiveInStore(r.latest) && r.info && !LIVE_STATUSES.has(r.info.status as never)) {
      gone[r.latest] = r.info;
    }
  }
  return { replace, gone };
}

/** Pins whose session is not live here: the only ones worth asking main about */
export function pinsToResolve(
  watched: string[],
  agents: Record<string, { status: string } | undefined>,
): string[] {
  return watched.filter((id) => {
    const a = agents[id];
    return !a || !LIVE_STATUSES.has(a.status as never);
  });
}

export async function followWatched(): Promise<void> {
  const { watched, replaceAgent, setGone } = useWatchStore.getState();
  const agents = useAgentStore.getState().agents;
  const ids = pinsToResolve(watched, agents);
  if (ids.length === 0) {
    setGone({});
    return;
  }
  const results = await trpcInvoke<WatchResolution[]>("agents.resolveWatched", { ids }).catch(
    () => null,
  );
  if (!results) return;
  const live = (id: string) => {
    const a = useAgentStore.getState().agents[id];
    return !!a && LIVE_STATUSES.has(a.status);
  };
  const { replace, gone } = planWatchFollow(results, live);
  for (const [from, to] of replace) replaceAgent(from, to);
  setGone(gone);
}

/** On load and whenever the store's sessions change (a resume, a crash), throttled */
export function startWatchFollow(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = null;
      void followWatched();
    }, THROTTLE_MS);
  };
  void followWatched();
  let lastKey = "";
  const unsubAgents = useAgentStore.subscribe((s) => {
    const key = Object.values(s.agents)
      .map((a) => `${a.id}:${a.status}`)
      .join(",");
    if (key === lastKey) return;
    lastKey = key;
    schedule();
  });
  const unsubWatch = useWatchStore.subscribe((s, prev) => {
    if (s.watched !== prev.watched) schedule();
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubAgents();
    unsubWatch();
  };
}
