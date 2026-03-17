import { Button, ScrollArea, Separator } from "@exegol/ui";
import { FolderOpen, History, Plus } from "lucide-react";
import { useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { SpawnAgentDialog } from "../agents/SpawnAgentDialog";
import { ProjectsSection } from "./ProjectsSection";
import { RecentSessions } from "./RecentSessions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSection } from "./SidebarSection";

export function Sidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: projects } = useProjects();

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);

  const projectCount = projects?.length ?? 0;

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

      {/* Scrollable middle — Projects + Sessions (main content, can grow) */}
      <ScrollArea className="flex-1">
        <SidebarSection
          title="Projects"
          icon={FolderOpen}
          defaultOpen={true}
          count={projectCount}
          action={
            <button
              type="button"
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

        <SidebarSection title="Recent Sessions" icon={History} defaultOpen={false}>
          <RecentSessions />
        </SidebarSection>
      </ScrollArea>

      <Separator className="bg-border" />

      {/* Footer — Schedulers, Resources (compact), All Projects + version */}
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
  );
}
