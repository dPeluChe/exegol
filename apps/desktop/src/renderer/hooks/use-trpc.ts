import type {
  Activity,
  Agent,
  AgentCostRow,
  AgentCreate,
  DailyTrendRow,
  MetricsSnapshot,
  ModelBreakdownRow,
  Project,
  ProjectCreate,
  Prompt,
  PromptCreate,
  PromptUpdate,
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
    refetchInterval: 30_000, // Reduced: push events (T17) handle real-time updates
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => trpcInvoke<Agent>("agents.get", { id }),
    enabled: !!id,
    refetchInterval: 10_000, // Reduced: push events (T17) handle real-time updates
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
    refetchInterval: 30_000, // Reduced: push events (T17) handle real-time updates
  });
}

export function useMetricsHistory() {
  return useQuery({
    queryKey: ["resources", "history"],
    queryFn: () => trpcInvoke<MetricsSnapshot[]>("resources.history"),
    refetchInterval: 30_000, // Reduced: push events (T17) handle real-time updates
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

// ─── Files ──────────────────────────────────────────────────────────────────

export function useFileContent(path: string | null) {
  return useQuery({
    queryKey: ["file", path],
    queryFn: () => trpcInvoke<{ content: string; language: string }>("files.readFile", { path }),
    enabled: !!path,
  });
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

export function useDirectoryListing(path: string | null) {
  return useQuery({
    queryKey: ["directory", path],
    queryFn: () => trpcInvoke<DirectoryEntry[]>("files.listDirectory", { path }),
    enabled: !!path,
  });
}

export function usePickFile() {
  return useMutation({
    mutationFn: (params: { projectPath: string }) =>
      trpcMutate<string | null>("files.pickFile", params),
  });
}

export function useWriteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { path: string; content: string }) =>
      trpcMutate<{ success: boolean }>("files.writeFile", params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file", variables.path] });
    },
  });
}

// ─── Prompts ────────────────────────────────────────────────────────────────

export function usePrompts(projectId: string | null) {
  return useQuery({
    queryKey: ["prompts", projectId],
    queryFn: () => trpcInvoke<Prompt[]>("prompts.list", { projectId }),
    enabled: !!projectId,
  });
}

export function useCreatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PromptCreate) => trpcMutate<Prompt>("prompts.create", data),
    onSuccess: (prompt) => {
      queryClient.invalidateQueries({ queryKey: ["prompts", prompt.projectId] });
    },
  });
}

export function useUpdatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PromptUpdate & { id: string }) =>
      trpcMutate<{ success: boolean }>("prompts.update", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("prompts.delete", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
  });
}

export function useTogglePinPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("prompts.togglePin", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    },
  });
}

// ─── Activities (T20) ────────────────────────────────────────────────────────

export function useActivities(projectId: string | null, type?: string) {
  return useQuery({
    queryKey: ["activities", projectId, type],
    queryFn: () =>
      trpcInvoke<Activity[]>("activities.list", {
        projectId: projectId ?? undefined,
        type,
        limit: 100,
      }),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export function useDiff(projectId: string | null, mode: "unstaged" | "staged") {
  const procedure = mode === "staged" ? "diff.stagedDiff" : "diff.projectDiff";
  return useQuery({
    queryKey: ["diff", projectId, mode],
    queryFn: () => trpcInvoke<string>(procedure, { projectId }),
    enabled: !!projectId,
  });
}

// ─── Scrollback ──────────────────────────────────────────────────────────────

export function useScrollback(agentId: string | null) {
  return useQuery({
    queryKey: ["scrollback", agentId],
    queryFn: () => trpcInvoke<string | null>("scrollback.get", { agentId }),
    enabled: !!agentId,
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
