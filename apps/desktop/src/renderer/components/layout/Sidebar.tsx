import { ScrollArea, Separator } from "@exegol/ui";
import { FolderOpen, History, Plus, Rss } from "lucide-react";
import { useProjects } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ActivityFeed } from "./ActivityFeed";
import { ProjectsSection } from "./ProjectsSection";
import { RecentSessions } from "./RecentSessions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSection } from "./SidebarSection";

export function Sidebar() {
  const { data: projects } = useProjects();
  const projectCount = projects?.length ?? 0;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <SidebarHeader />

      {/* Scrollable middle — Projects + Sessions */}
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

        <Separator className="mx-3 bg-border" />

        <SidebarSection title="Activity" icon={Rss} defaultOpen={false}>
          <ActivityFeed />
        </SidebarSection>
      </ScrollArea>

      <Separator className="bg-border" />

      <SidebarFooter />
    </div>
  );
}
