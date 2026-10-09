import type { Agent } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpcInvoke } from "../lib/trpc-client";
import { FLEET_SYNC, useAgentStore } from "../stores/agents";

let appliedAt = 0;

/**
 * Every project's live agents in the store, from startup. Only the active project was loaded
 * (the Dashboard did the rest), so after a restart the sidebar counts stayed empty until each
 * project was opened. `agents.listActive` answers at once, mid-reattach too: the sidebar lists the
 * sessions while they reconnect, and the end of recovery refetches it.
 */
export function useFleetSync<T extends Agent = Agent>(): T[] | undefined {
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["agents", "listActive"],
    queryFn: () => trpcInvoke<T[]>("agents.listActive"),
    refetchInterval: 60_000,
  });
  // Once per fetch: a Dashboard mounting later replayed a cached list and brought closed sessions
  // back as live
  useEffect(() => {
    if (!data?.length || dataUpdatedAt <= appliedAt) return;
    appliedAt = dataUpdatedAt;
    useAgentStore.getState().syncFromDb(FLEET_SYNC, data);
  }, [data, dataUpdatedAt]);
  return data;
}
