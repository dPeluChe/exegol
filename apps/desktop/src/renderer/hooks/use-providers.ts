import type { AgentProvider } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { trpcInvoke } from "../lib/trpc-client";

const KEY = ["enabledProviders"];
const NONE: AgentProvider[] = [];

/** Enabled providers, each marked installed or not (its command on PATH, checked in main) */
export function useEnabledProviders(): AgentProvider[] {
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  return data ?? NONE;
}

/** Installed first, so quick launchers never offer a CLI that is not on this machine */
export const isLaunchable = (p: AgentProvider) => p.installed !== false;

export function useLaunchableProviders(): AgentProvider[] {
  const providers = useEnabledProviders();
  return useMemo(() => providers.filter(isLaunchable), [providers]);
}

/** Check PATH again now (after installing a CLI in a terminal) */
export function useRecheckProviders(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const fresh = await trpcInvoke<AgentProvider[]>("agents.listEnabledProviders", {
      fresh: true,
    });
    queryClient.setQueryData(KEY, fresh);
  }, [queryClient]);
}
