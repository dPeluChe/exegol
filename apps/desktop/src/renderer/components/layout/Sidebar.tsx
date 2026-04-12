import { ScrollArea, Separator } from "@exegol/ui";
import { Activity, Cuboid, History, Plus, Rss } from "lucide-react";
import { useProjects } from "../../hooks/use-trpc";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { ActivityFeed } from "./ActivityFeed";
import { AttentionSection } from "./AttentionSection";
import { ProjectsSection } from "./ProjectsSection";
import { RecentSessions } from "./RecentSessions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSection } from "./SidebarSection";

export function Sidebar() {
  const { data: projects } = useProjects();
  const projectCount = projects?.length ?? 0;
  const attentionCount = useAgentStore((s) => s.unreadAttentionCount);
  const runningCount = useAgentStore(
    (s) =>
      Object.values(s.agents).filter(
        (a) => a.status === "running" || a.status === "spawning" || a.status === "waiting_input",
      ).length,
  );
  const agentBadge =
    attentionCount > 0 ? attentionCount : runningCount > 0 ? runningCount : undefined;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <SidebarHeader />

      {/* Scrollable middle — Agent Monitor + Projects + Sessions */}
      <ScrollArea className="flex-1">
        {/* T57: Agent monitor — running agents + attention inbox */}
        <SidebarSection title="Agents" icon={Activity} defaultOpen={true} count={agentBadge}>
          <AttentionSection />
        </SidebarSection>

        <Separator className="mx-3 bg-border" />

        <SidebarSection
          title="Projects"
          icon={Cuboid}
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
