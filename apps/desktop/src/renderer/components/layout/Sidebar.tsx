import { useState } from 'react'
import {
  FolderOpen,
  Settings,
  ChevronDown,
  Plus,
  LayoutGrid,
} from 'lucide-react'
import { Button, ScrollArea, Separator, cn } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useAgentStore } from '../../stores/agents'
import { useProjects, useAppVersion } from '../../hooks/use-trpc'
import { AgentCard } from '../agents/AgentCard'
import { SpawnAgentDialog } from '../agents/SpawnAgentDialog'

export function Sidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const agents = Object.values(useAgentStore((s) => s.agents))
  const { data: projects } = useProjects()
  const { data: appVersion } = useAppVersion()

  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false)
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)

  const activeProject = projects?.find((p) => p.id === activeProjectId)
  const projectAgents = agents.filter(
    (a) => a.projectId === activeProjectId,
  )

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: 'var(--bg-secondary)' }}
    >
      {/* Project Selector */}
      <div className="p-3">
        <button
          onClick={() => setProjectSelectorOpen(!projectSelectorOpen)}
          className={cn(
            'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors',
            'hover:bg-white/5',
          )}
          style={{ color: 'var(--text-primary)' }}
        >
          <div className="flex items-center gap-2 truncate">
            <FolderOpen className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="truncate">
              {activeProject?.name ?? 'Select Project'}
            </span>
          </div>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              projectSelectorOpen && 'rotate-180',
            )}
            style={{ color: 'var(--text-muted)' }}
          />
        </button>

        {projectSelectorOpen && projects && (
          <div
            className="mt-1 rounded-md border p-1"
            style={{
              background: 'var(--bg-tertiary)',
              borderColor: 'var(--border)',
            }}
          >
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setActiveProject(project.id)
                  setProjectSelectorOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors',
                  'hover:bg-white/5',
                  project.id === activeProjectId && 'bg-white/10',
                )}
                style={{ color: 'var(--text-primary)' }}
              >
                <FolderOpen className="h-3 w-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
            {projects.length === 0 && (
              <p className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                No projects yet
              </p>
            )}
          </div>
        )}
      </div>

      <Separator style={{ background: 'var(--border)' }} />

      {/* Agents Section */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Agents
        </span>
        <button
          onClick={() => setSpawnDialogOpen(true)}
          disabled={!activeProjectId}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded transition-colors',
            activeProjectId ? 'hover:bg-white/10 cursor-pointer' : 'opacity-30 cursor-not-allowed',
          )}
          style={{ color: 'var(--text-muted)' }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 py-1">
          {projectAgents.length > 0 ? (
            projectAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))
          ) : (
            <p
              className="px-2 py-4 text-center text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              {activeProjectId
                ? 'No agents running'
                : 'Select a project first'}
            </p>
          )}
        </div>
      </ScrollArea>

      <Separator style={{ background: 'var(--border)' }} />

      {/* Navigation */}
      <div className="space-y-0.5 p-2">
        <button
          onClick={() => setActiveView('projects')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            'hover:bg-white/5',
            activeView === 'projects' && 'bg-white/10',
          )}
          style={{ color: 'var(--text-secondary)' }}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Projects
        </button>
        <button
          onClick={() => setActiveView('settings')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            'hover:bg-white/5',
            activeView === 'settings' && 'bg-white/10',
          )}
          style={{ color: 'var(--text-secondary)' }}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>

      {/* App version */}
      <div className="border-t px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Exegol v{appVersion ?? '...'}
        </span>
      </div>

      {/* Spawn Dialog */}
      {activeProjectId && (
        <SpawnAgentDialog
          open={spawnDialogOpen}
          onOpenChange={setSpawnDialogOpen}
          projectId={activeProjectId}
        />
      )}
    </div>
  )
}
