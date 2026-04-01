import type {
  AgentCostRow,
  DailyTrendRow,
  ModelBreakdownRow,
  TokenUsage,
  TokenUsageSummary,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Token Usage ─────────────────────────────────────────────────────────────

export function useTokenUsageSummary(agentId?: string, projectId?: string) {
  return useQuery({
    queryKey: ["tokenUsage", agentId ?? projectId ?? "all"],
    queryFn: () => {
      const input: { agentId?: string; projectId?: string } = {};
      if (agentId) input.agentId = agentId;
      else if (projectId) input.projectId = projectId;
      return trpcInvoke<TokenUsageSummary>(
        "tokenUsage.summary",
        Object.keys(input).length > 0 ? input : undefined,
      );
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useTokenHistory(projectId: string | null) {
  return useQuery({
    queryKey: ["tokenUsage", "history", projectId],
    queryFn: () => trpcInvoke<TokenUsage[]>("tokenUsage.history", { projectId, days: 30 }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

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

// T19: Per-model breakdown

export function useModelBreakdown(projectId: string | null, days = 30) {
  return useQuery({
    queryKey: ["tokenUsage", "modelBreakdown", projectId, days],
    queryFn: () =>
      trpcInvoke<ModelBreakdownRow[]>("tokenUsage.modelBreakdown", { projectId, days }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// T19: Per-agent costs

export function useAgentCosts(projectId: string | null, days = 30) {
  return useQuery({
    queryKey: ["tokenUsage", "agentCosts", projectId, days],
    queryFn: () => trpcInvoke<AgentCostRow[]>("tokenUsage.agentCosts", { projectId, days }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// T19: Daily trend

export function useDailyTrend(projectId: string | null, days = 30) {
  return useQuery({
    queryKey: ["tokenUsage", "dailyTrend", projectId, days],
    queryFn: () => trpcInvoke<DailyTrendRow[]>("tokenUsage.dailyTrend", { projectId, days }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}
