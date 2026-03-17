import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, ScrollArea, Separator } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { SpawnAgentDialog } from '../agents/SpawnAgentDialog'
import { SidebarHeader } from './SidebarHeader'
import { ProjectsSection } from './ProjectsSection'
import { RecentSessions } from './RecentSessions'
import { SidebarFooter } from './SidebarFooter'

export function Sidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* Header: App name + settings gear */}
      <SidebarHeader />

      {/* New Agent CTA */}
      <div className="px-3 py-2">
        <Button
          onClick={() => setSpawnDialogOpen(true)}
          disabled={!activeProjectId}
          size="sm"
          className="w-full gap-2 bg-accent text-xs text-white hover:bg-accent/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </Button>
      </div>

      <Separator className="bg-border" />

      {/* Scrollable middle area */}
      <ScrollArea className="flex-1">
        {/* Projects section */}
        <ProjectsSection
          onAddProject={() => setActiveView('projects')}
        />

        <Separator className="bg-border" />

        {/* Recent sessions */}
        <RecentSessions />
      </ScrollArea>

      <Separator className="bg-border" />

      {/* Bottom bar */}
      <SidebarFooter />

      {/* Spawn dialog */}
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
