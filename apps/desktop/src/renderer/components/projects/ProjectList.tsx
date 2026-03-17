import { useState } from 'react'
import { FolderOpen, Plus, GitBranch, Clock, Cpu } from 'lucide-react'
import { Button, cn } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useProjects } from '../../hooks/use-trpc'
import { useAgentStore } from '../../stores/agents'
import { AddProjectDialog } from './AddProjectDialog'
import type { Project } from '@exegol/shared'

function formatRelativeTime(timestampSeconds: number): string {
  const diff = Date.now() - timestampSeconds * 1000
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestampSeconds * 1000).toLocaleDateString()
}

function ProjectCard({ project }: { project: Project }) {
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const agents = Object.values(useAgentStore((s) => s.agents))
  const projectAgentCount = agents.filter((a) => a.projectId === project.id).length

  return (
    <button
      onClick={() => setActiveProject(project.id)}
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 text-left transition-all',
        'hover:border-[var(--accent)]/50 hover:bg-white/[0.02]',
      )}
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <FolderOpen className="h-5 w-5" style={{ color: 'var(--accent)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {project.name}
          </h3>
          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {project.path}
          </p>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {project.defaultBranch}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(project.lastOpenedAt)}
        </span>
        {projectAgentCount > 0 && (
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {projectAgentCount} agent{projectAgentCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  )
}

export function ProjectList() {
  const { data: projects, isLoading, isError } = useProjects()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Projects
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Select a project to start working with agents
          </p>
        </div>
        <Button
          onClick={() => setAddDialogOpen(true)}
          className="gap-2 text-white"
          style={{ background: 'var(--accent)' }}
        >
          <Plus className="h-4 w-4" />
          Add Project
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading projects...
            </p>
          </div>
        )}

        {isError && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--error)' }}>
              Failed to load projects
            </p>
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="flex h-60 flex-col items-center justify-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <FolderOpen className="h-8 w-8" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                No projects yet
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Add a git repository to start orchestrating agents
              </p>
            </div>
            <Button
              onClick={() => setAddDialogOpen(true)}
              className="gap-2 text-white"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" />
              Add Your First Project
            </Button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      <AddProjectDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
