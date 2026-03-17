import { useState } from 'react'
import {
  Plus,
  FolderOpen,
  History,
  Clock,
  Activity,
} from 'lucide-react'
import { Button, ScrollArea, Separator } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useProjects } from '../../hooks/use-trpc'
import { SpawnAgentDialog } from '../agents/SpawnAgentDialog'
import { SidebarHeader } from './SidebarHeader'
import { SidebarSection } from './SidebarSection'
import { ProjectsSection } from './ProjectsSection'
import { RecentSessions } from './RecentSessions'
import { SchedulersOverview } from './SchedulersOverview'
import { ResourcesOverview } from './ResourcesOverview'
import { SidebarFooter } from './SidebarFooter'

export function Sidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const { data: projects } = useProjects()

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)

  const projectCount = projects?.length ?? 0

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <SidebarHeader />

      {/* New Agent CTA */}
      <div className="px-3 py-2">
        <Button
          onClick={() => setSpawnDialogOpen(true)}
          disabled={!activeProjectId}
          size="sm"
          className="w-full gap-2 bg-accent text-xs text-white hover:bg-accent-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </Button>
      </div>

      <Separator className="bg-border" />

      {/* Scrollable sections */}
      <ScrollArea className="flex-1">
        {/* Projects */}
        <SidebarSection
          title="Projects"
          icon={FolderOpen}
          defaultOpen={true}
          count={projectCount}
          action={
            <button
              onClick={() => useAppStore.getState().setActiveProject(null)}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-secondary"
              title="Add project"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          }
        >
          <ProjectsSection onAddProject={() => useAppStore.getState().setActiveProject(null)} />
        </SidebarSection>

        <Separator className="mx-3 bg-border" />

        {/* Recent Sessions */}
        <SidebarSection
          title="Recent Sessions"
          icon={History}
          defaultOpen={false}
        >
          <RecentSessions />
        </SidebarSection>

        <Separator className="mx-3 bg-border" />

        {/* Schedulers - global overview */}
        <SidebarSection
          title="Schedulers"
          icon={Clock}
          defaultOpen={false}
        >
          <SchedulersOverview />
        </SidebarSection>

        <Separator className="mx-3 bg-border" />

        {/* Resources - global overview */}
        <SidebarSection
          title="Resources"
          icon={Activity}
          defaultOpen={false}
        >
          <ResourcesOverview />
        </SidebarSection>
      </ScrollArea>

      <Separator className="bg-border" />

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
