import type { MetricsSnapshot } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";

// ─── Resources ──────────────────────────────────────────────────────────────

export interface SystemMetrics {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; free: number; usagePercent: number };
  uptime: number;
}

export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  projectPath: string;
  diskUsage: number;
  worktreeCount: number;
  agentProcesses: { pid: number; cpu: number; memory: number }[];
}

export function useSystemMetrics() {
  return useQuery({
    queryKey: ["resources", "system"],
    queryFn: () => trpcInvoke<SystemMetrics>("resources.system"),
    refetchInterval: 60_000, // Fallback — push events deliver every 10s
    staleTime: 15_000,
  });
}

export function useMetricsHistory() {
  return useQuery({
    queryKey: ["resources", "history"],
    queryFn: () => trpcInvoke<MetricsSnapshot[]>("resources.history"),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useProjectMetrics(
  projectId: string | null,
  projectPath: string | null,
  projectName: string | null,
) {
  return useQuery({
    queryKey: ["resources", "project", projectId],
    queryFn: () =>
      trpcInvoke<ProjectMetrics>("resources.project", { projectId, projectPath, projectName }),
    refetchInterval: 60_000, // Heavy: du, git worktree, pgrep, ps
    staleTime: 30_000,
    enabled: !!projectId && !!projectPath,
  });
}
