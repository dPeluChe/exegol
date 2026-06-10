import type {
  Agent,
  AgentCreate,
  Project,
  ProjectCreate,
  Prompt,
  PromptCreate,
  PromptUpdate,
  RecentSession,
  Settings,
} from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

// ─── Domain re-exports (barrel) ─────────────────────────────────────────────

export * from "./use-trpc-diff-comments";
export * from "./use-trpc-github";
export * from "./use-trpc-mcp";
export * from "./use-trpc-memory";
export * from "./use-trpc-pipeline";
export * from "./use-trpc-resources";
export * from "./use-trpc-scheduler";
export * from "./use-trpc-scoring";
export * from "./use-trpc-search";
export * from "./use-trpc-skills";
export * from "./use-trpc-tokens";

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

export function useWorktrees(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["worktrees", projectId],
    queryFn: () =>
      trpcInvoke<import("@exegol/shared").Worktree[]>("projects.listWorktrees", { projectId }),
    enabled,
    staleTime: 30_000,
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
    refetchInterval: 30_000, // Fallback only — push events (T17) handle real-time updates
    staleTime: 10_000,
    retry: (failureCount, error) => {
      // Don't retry if agent was deleted — prevents console spam from stale workspace panes
      if (error && typeof error === "object" && "code" in error && error.code === "NOT_FOUND")
        return false;
      return failureCount < 2;
    },
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
      // T120: settings live in their own window — fan out to peer windows so
      // their TanStack Query caches refetch (theme, terminal font, etc.).
      window.api.settings.broadcastChanged();
    },
  });
}

// ─── API Keys ───────────────────────────────────────────────────────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => trpcInvoke<Array<{ provider: string; hasKey: boolean }>>("apiKeys.list"),
  });
}

export function useKeystoreEncryptionAvailable() {
  return useQuery({
    queryKey: ["apiKeys", "encryptionAvailable"],
    queryFn: () => trpcInvoke<boolean>("apiKeys.encryptionAvailable"),
    staleTime: Number.POSITIVE_INFINITY,
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
