import { useState, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Plus,
} from 'lucide-react'
import { cn } from '@exegol/ui'
import { useProjects } from '../../hooks/use-trpc'
import { useAppStore } from '../../stores/app'
import { useAgentStore, type AgentState } from '../../stores/agents'
import type { Project } from '@exegol/shared'

// ─── Agent Mini Card ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  waiting_input: 'bg-yellow-500',
  spawning: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  idle: 'bg-zinc-500',
  paused: 'bg-zinc-500',
}

function AgentMiniCard({ agent }: { agent: AgentState }) {
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent)
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId)
  const isFocused = focusedAgentId === agent.id
  const isActive = ['running', 'spawning', 'waiting_input'].includes(
    agent.status,
  )

  return (
    <button
      onClick={() => setFocusedAgent(agent.id)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] transition-colors',
        isFocused
          ? 'bg-white/10 text-text-primary'
          : 'text-text-muted hover:bg-white/5 hover:text-text-secondary',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          STATUS_COLORS[agent.status] ?? 'bg-zinc-500',
          isActive && 'animate-status-pulse',
        )}
      />
      <span className="flex-1 truncate">{agent.taskDescription}</span>
    </button>
  )
}

// ─── Project Item ─────────────────────────────────────────────────────────────

interface ProjectItemProps {
  project: Project
  isSelected: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggle: () => void
  agents: AgentState[]
}

function ProjectItem({
  project,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  agents,
}: ProjectItemProps) {
  const runningCount = agents.filter((a) =>
    ['running', 'spawning', 'waiting_input'].includes(a.status),
  ).length

  return (
    <div>
      {/* Project row */}
      <button
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
          isSelected
            ? 'bg-white/10 text-text-primary'
            : 'text-text-secondary hover:bg-white/5',
        )}
      >
        {/* Expand/collapse chevron */}
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="shrink-0"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>

        {/* Folder icon */}
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />

        {/* Project name */}
        <span className="flex-1 truncate font-medium">{project.name}</span>

        {/* Running agent count badge */}
        {runningCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] text-accent">
            {runningCount}
          </span>
        )}
      </button>

      {/* Expanded content: branch info + agents */}
      {isExpanded && (
        <div className="ml-5 border-l border-border/50 pl-2">
          {/* Git info line */}
          <div className="flex items-center gap-1.5 py-1 text-[10px] text-text-muted">
            <GitBranch className="h-2.5 w-2.5" />
            <span>{project.defaultBranch}</span>
          </div>

          {/* Active agents */}
          {agents.length > 0 ? (
            agents.map((agent) => (
              <AgentMiniCard key={agent.id} agent={agent} />
            ))
          ) : (
            <p className="py-1 text-[10px] italic text-text-muted">
              No agents
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Projects Section ─────────────────────────────────────────────────────────

interface ProjectsSectionProps {
  onAddProject: () => void
}

export function ProjectsSection({ onAddProject }: ProjectsSectionProps) {
  const { data: projects } = useProjects()
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const agents = useAgentStore((s) => s.agents)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Auto-expand the active project
  useEffect(() => {
    if (activeProjectId) {
      setExpandedIds((prev) => {
        if (prev.has(activeProjectId)) return prev
        const next = new Set(prev)
        next.add(activeProjectId)
        return next
      })
    }
  }, [activeProjectId])

  const toggleProject = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const agentList = Object.values(agents)

  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Projects
        </span>
        <button
          onClick={onAddProject}
          className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-secondary"
          title="Add project"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-0.5">
        {projects && projects.length > 0 ? (
          projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              isSelected={project.id === activeProjectId}
              isExpanded={expandedIds.has(project.id)}
              onSelect={() => setActiveProject(project.id)}
              onToggle={() => toggleProject(project.id)}
              agents={agentList.filter((a) => a.projectId === project.id)}
            />
          ))
        ) : (
          <p className="py-2 text-center text-xs text-text-muted">
            No projects yet
          </p>
        )}
      </div>
    </div>
  )
}
