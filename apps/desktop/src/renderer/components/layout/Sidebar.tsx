import { useState } from 'react'
import { Separator } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useAppVersion } from '../../hooks/use-trpc'
import { SpawnAgentDialog } from '../agents/SpawnAgentDialog'
import { ProjectSelector } from './ProjectSelector'
import { AgentList } from './AgentList'
import { NavSection } from './NavSection'

export function Sidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const { data: appVersion } = useAppVersion()

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)

  return (
    <div
      className="flex h-full flex-col bg-bg-secondary"
    >
      <ProjectSelector
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProject}
      />

      <Separator className="bg-border" />

      <AgentList
        projectId={activeProjectId}
        onSpawnClick={() => setSpawnDialogOpen(true)}
      />

      <Separator className="bg-border" />

      <NavSection
        activeView={activeView}
        onNavigate={setActiveView}
        appVersion={appVersion}
      />

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
