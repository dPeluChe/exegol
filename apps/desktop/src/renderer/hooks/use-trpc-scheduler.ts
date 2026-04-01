import type { ScheduledResult, ScheduledTask, ScheduledTaskCreate } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Scheduler ──────────────────────────────────────────────────────────────

export function useScheduledTasks(projectId?: string | null) {
  return useQuery({
    queryKey: ["scheduler", "tasks", projectId ?? "all"],
    queryFn: () =>
      trpcInvoke<ScheduledTask[]>("scheduler.list", projectId ? { projectId } : undefined),
    refetchInterval: 30_000,
  });
}

export function useScheduledResults(taskId: string | null) {
  return useQuery({
    queryKey: ["scheduler", "results", taskId],
    queryFn: () => trpcInvoke<ScheduledResult[]>("scheduler.results", { taskId }),
    enabled: !!taskId,
    refetchInterval: 30_000,
  });
}

export function useCreateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ScheduledTaskCreate) => trpcMutate<ScheduledTask>("scheduler.create", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
  });
}

export function useUpdateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string } & Partial<ScheduledTaskCreate>) =>
      trpcMutate<ScheduledTask>("scheduler.update", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
  });
}

export function useDeleteScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("scheduler.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
  });
}

export function useToggleScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; enabled: boolean }) =>
      trpcMutate<ScheduledTask>("scheduler.toggle", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
  });
}

export function useRunScheduledTaskNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ triggered: boolean }>("scheduler.runNow", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
  });
}

// ─── Ports ──────────────────────────────────────────────────────────────────

export interface PortInfo {
  port: number;
  source: "runtime" | "config";
  pid?: number;
  process?: string;
  file?: string;
}

export function useProjectPorts(projectPath: string | null) {
  return useQuery({
    queryKey: ["resources", "ports", projectPath],
    queryFn: () => trpcInvoke<PortInfo[]>("resources.ports", { projectPath }),
    enabled: !!projectPath,
    refetchInterval: 30_000,
  });
}
