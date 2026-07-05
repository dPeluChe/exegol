import type { Budget, BudgetLimitType, BudgetPeriod, BudgetStatus } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useBudgets(projectId: string | null) {
  return useQuery({
    queryKey: ["budgets", "list", projectId],
    queryFn: () => trpcInvoke<Budget[]>("budgets.list", { projectId }),
    enabled: !!projectId,
  });
}

export function useBudgetStatus(projectId: string | null, period: BudgetPeriod) {
  return useQuery({
    queryKey: ["budgets", "status", projectId, period],
    queryFn: () => trpcInvoke<BudgetStatus>("budgets.status", { projectId, period }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export interface UpsertBudgetInput {
  projectId: string;
  period: BudgetPeriod;
  limitType: BudgetLimitType;
  limitValue: number;
  hardStop: boolean;
}

export function useUpsertBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertBudgetInput) => trpcMutate<Budget>("budgets.upsert", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("budgets.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
