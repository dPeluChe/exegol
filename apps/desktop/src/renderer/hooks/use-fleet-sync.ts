import type { Agent } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpcInvoke } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";

/**
 * Every project's live agents in the store, from startup. Only the active project was loaded
 * (the Dashboard did the rest), so after a restart the sidebar counts stayed empty until each
 * project was opened. `agents.listActive` answers after the sidecar reattach.
 */
export function useFleetSync<T extends Agent = Agent>(): T[] | undefined {
  const { data } = useQuery({
    queryKey: ["agents", "listActive"],
    queryFn: () => trpcInvoke<T[]>("agents.listActive"),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (data?.length) useAgentStore.getState().syncFromDb("__fleet__", data);
  }, [data]);
  return data;
}
