import type { AgentProvider } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { trpcInvoke } from "../lib/trpc-client";

const KEY = ["enabledProviders"];
const NONE: AgentProvider[] = [];

export const enabledProvidersQuery = {
  queryKey: KEY,
  queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
  staleTime: 30_000,
};

/** Enabled providers, each marked installed or not (its command on PATH, checked in main) */
export function useEnabledProviders(): AgentProvider[] {
  const { data } = useQuery(enabledProvidersQuery);
  return data ?? NONE;
}

/** Quick launchers offer only CLIs that are on this machine */
export const isLaunchable = (p: AgentProvider) => p.installed !== false;

export function useLaunchableProviders(): AgentProvider[] {
  const providers = useEnabledProviders();
  return useMemo(() => providers.filter(isLaunchable), [providers]);
}

/** Check PATH again now (after installing a CLI in a terminal) */
export function useRecheckProviders(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: KEY }), [queryClient]);
}
