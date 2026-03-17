import type {
  Agent,
  AgentCreate,
  Project,
  ProjectCreate,
  RecentSession,
  ScheduledResult,
  ScheduledTask,
  ScheduledTaskCreate,
  Settings,
  TokenUsage,
  TokenUsageSummary,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Projects ────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => trpcInvoke<Project[]>("projects.list"),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => trpcInvoke<Project>("projects.get", { id }),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProjectCreate) => trpcMutate<Project>("projects.create", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("projects.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export function useAgents(projectId: string | null) {
  return useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => trpcInvoke<Agent[]>("agents.list", { projectId }),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => trpcInvoke<Agent>("agents.get", { id }),
    enabled: !!id,
    refetchInterval: 2_000,
  });
}

export function useSpawnAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AgentCreate) => trpcMutate<Agent>("agents.spawn", data),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["agents", agent.projectId] });
    },
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>("agents.stop", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

// ─── Recent Sessions ─────────────────────────────────────────────────────────

export function useRecentSessions(limit = 10) {
  return useQuery({
    queryKey: ["recentSessions", limit],
    queryFn: () => trpcInvoke<RecentSession[]>("agents.recentSessions", { limit }),
    refetchInterval: 30_000,
  });
}

// ─── Open in IDE ─────────────────────────────────────────────────────────────

export function useOpenInIde() {
  return useMutation({
    mutationFn: (data: { projectId: string; ide?: string; customPath?: string }) =>
      trpcMutate<{ success: boolean }>("projects.openInIde", data),
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => trpcInvoke<Settings>("settings.get"),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Settings>) => trpcMutate<Settings>("settings.update", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

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
    refetchInterval: 5_000,
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
      trpcMutate<{ imported: number; total: number }>("tokenUsage.scan", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokenUsage"] });
    },
  });
}

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
    refetchInterval: 10_000, // Matches background collector interval
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
    refetchInterval: 15_000, // Project metrics are heavier (du, git worktree)
    enabled: !!projectId && !!projectPath,
  });
}

// ─── API Keys ───────────────────────────────────────────────────────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => trpcInvoke<Array<{ provider: string; hasKey: boolean }>>("apiKeys.list"),
  });
}

export function useSetApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { provider: string; key: string }) =>
      trpcMutate<{ success: boolean }>("apiKeys.set", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

export function useScheduledTasks(projectId?: string | null) {
  return useQuery({
    queryKey: ["scheduler", "tasks", projectId ?? "all"],
    queryFn: () =>
      trpcInvoke<ScheduledTask[]>("scheduler.list", projectId ? { projectId } : undefined),
    refetchInterval: 10_000,
  });
}

export function useScheduledResults(taskId: string | null) {
  return useQuery({
    queryKey: ["scheduler", "results", taskId],
    queryFn: () => trpcInvoke<ScheduledResult[]>("scheduler.results", { taskId }),
    enabled: !!taskId,
    refetchInterval: 10_000,
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

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { provider: string }) =>
      trpcMutate<{ success: boolean }>("apiKeys.delete", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
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
    refetchInterval: 15_000,
  });
}

// ─── App Info ────────────────────────────────────────────────────────────────

export function useAppVersion() {
  return useQuery({
    queryKey: ["appVersion"],
    queryFn: () => window.api.app.getVersion(),
    staleTime: Infinity,
  });
}
