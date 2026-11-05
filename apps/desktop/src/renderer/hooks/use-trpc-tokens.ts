import type { UsageLimit, UsageReport } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

export function useTokenScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string }) =>
      trpcMutate<{ imported: number; skipped: number; total: number }>("tokenUsage.scan", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokenUsage"] });
    },
  });
}

/** The numbers change only on an import, so the page refetches on its push instead of polling */
export function useUsage(projectId: string | null, days: number) {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api?.onUsageUpdated?.(() => {
      void queryClient.invalidateQueries({ queryKey: ["tokenUsage"] });
    }),
  );
  return useQuery({
    queryKey: ["tokenUsage", "usage", projectId, days],
    queryFn: () =>
      trpcInvoke<UsageReport>("tokenUsage.usage", { days, projectId: projectId ?? undefined }),
  });
}

export function useUsageLimits() {
  return useQuery({
    queryKey: ["tokenUsage", "limits"],
    queryFn: () => trpcInvoke<UsageLimit[]>("tokenUsage.limits"),
  });
}

export function useSetUsageLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { cli: string; limitUsd: number | null }) =>
      trpcMutate<void>("tokenUsage.setLimit", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokenUsage", "limits"] });
    },
  });
}
