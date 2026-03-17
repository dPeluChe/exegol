import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { trpcInvoke, trpcMutate } from '../lib/trpc-client'
import type { Project, ProjectCreate, Agent, AgentCreate, Settings, TokenUsageSummary } from '@exegol/shared'

// ─── Projects ────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => trpcInvoke<Project[]>('projects.list'),
  })
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => trpcInvoke<Project>('projects.get', { id }),
    enabled: !!id,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ProjectCreate) => trpcMutate<Project>('projects.create', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>('projects.delete', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export function useAgents(projectId: string | null) {
  return useQuery({
    queryKey: ['agents', projectId],
    queryFn: () => trpcInvoke<Agent[]>('agents.list', { projectId }),
    enabled: !!projectId,
    refetchInterval: 3_000,
  })
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ['agent', id],
    queryFn: () => trpcInvoke<Agent>('agents.get', { id }),
    enabled: !!id,
    refetchInterval: 2_000,
  })
}

export function useSpawnAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AgentCreate) => trpcMutate<Agent>('agents.spawn', data),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents', agent.projectId] })
    },
  })
}

export function useStopAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => trpcMutate<void>('agents.stop', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => trpcInvoke<Settings>('settings.get'),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Settings>) => trpcMutate<Settings>('settings.update', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

// ─── Token Usage ─────────────────────────────────────────────────────────────

export function useTokenUsageSummary(agentId?: string) {
  return useQuery({
    queryKey: ['tokenUsage', agentId ?? 'all'],
    queryFn: () =>
      trpcInvoke<TokenUsageSummary>('tokenUsage.summary', agentId ? { agentId } : undefined),
    refetchInterval: 5_000,
  })
}

// ─── App Info ────────────────────────────────────────────────────────────────

export function useAppVersion() {
  return useQuery({
    queryKey: ['appVersion'],
    queryFn: () => window.api.app.getVersion(),
    staleTime: Infinity,
  })
}
