import { createContext, useContext, useMemo } from 'react'
import type { Project } from '@exegol/shared'
import { useAppStore } from '../stores/app'
import { useAgentStore, type AgentState } from '../stores/agents'
import { useProject } from '../hooks/use-trpc'

export interface ProjectContextValue {
  project: Project | null
  projectId: string | null
  isLoading: boolean
  /** Agents filtered for the active project */
  agents: AgentState[]
  /** Count of agents with status 'running' */
  runningAgentCount: number
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const { data: project, isLoading } = useProject(activeProjectId)
  const allAgents = Object.values(useAgentStore((s) => s.agents))

  const value = useMemo<ProjectContextValue>(() => {
    const agents = activeProjectId
      ? allAgents.filter((a) => a.projectId === activeProjectId)
      : []
    const runningAgentCount = agents.filter((a) => a.status === 'running').length

    return {
      project: project ?? null,
      projectId: activeProjectId,
      isLoading,
      agents,
      runningAgentCount,
    }
  }, [activeProjectId, project, isLoading, allAgents])

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProjectContext must be used within a <ProjectProvider>')
  }
  return ctx
}
