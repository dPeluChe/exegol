import { useState } from 'react'
import { FolderOpen, ChevronDown } from 'lucide-react'
import { cn } from '@exegol/ui'
import { useProjects } from '../../hooks/use-trpc'

export interface ProjectSelectorProps {
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
}

export function ProjectSelector({ activeProjectId, onSelectProject }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const { data: projects } = useProjects()

  const activeProject = projects?.find((p) => p.id === activeProjectId)

  return (
    <div className="p-3">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-text-primary transition-colors',
          'hover:bg-white/5',
        )}
      >
        <div className="flex items-center gap-2 truncate">
          <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate">
            {activeProject?.name ?? 'Select Project'}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && projects && (
        <div
          className="mt-1 rounded-md border border-border bg-bg-tertiary p-1"
        >
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                onSelectProject(project.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-text-primary transition-colors',
                'hover:bg-white/5',
                project.id === activeProjectId && 'bg-white/10',
              )}
            >
              <FolderOpen className="h-3 w-3 shrink-0 text-text-muted" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-text-muted">
              No projects yet
            </p>
          )}
        </div>
      )}
    </div>
  )
}
