import { ScrollArea, Separator } from "@exegol/ui";
import { Activity, Cuboid, History, LayoutDashboard, Plus, Rss } from "lucide-react";
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

      {/* Exegol's main view (Antonio 2026-08-11): the cross-project fleet
          dashboard sits above everything — one click from anywhere. */}
      <button
        type="button"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("exegol:switch-section", { detail: { section: "agent-dashboard" } }),
          )
        }
        className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-accent/20"
      >
        <LayoutDashboard className="h-3.5 w-3.5 text-accent" />
        Dashboard
        {attentionCount > 0 && (
          <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            {attentionCount}
          </span>
        )}
      </button>

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
