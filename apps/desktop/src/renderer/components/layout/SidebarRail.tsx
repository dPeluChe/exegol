import { LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { LayoutDashboard, PanelLeftOpen, Pause, Plus, Settings } from "lucide-react";
import { useMemo } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { ProjectAvatar } from "../common/ProjectAvatar";

/**
 * The collapsed sidebar: icons instead of nothing. Collapsing used to hide the
 * sidebar entirely, taking the attention count and the project list with it.
 * Each project shows its live agents and an amber dot when one needs you.
 */
export function SidebarRail() {
  const { data: projects = [] } = useProjects();
  const agents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const unread = useAgentStore((s) => s.unreadAttentionCount);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const onDashboard = useAppStore((s) => s.activeView === "dashboard");

  const perProject = useMemo(() => {
    const live = new Map<string, number>();
    const paused = new Set<string>();
    for (const a of Object.values(agents)) {
      if (!LIVE_STATUSES.has(a.status) || a.cliType === "shell") continue;
      if (a.suspended) paused.add(a.projectId);
      else live.set(a.projectId, (live.get(a.projectId) ?? 0) + 1);
    }
    const waiting = new Set(
      Object.values(attentionItems)
        .filter((i) => !i.read)
        .map((i) => i.projectId),
    );
    return { live, paused, waiting };
  }, [agents, attentionItems]);

  const railButton =
    "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors";

  return (
    <div className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-secondary py-2">
      <button
        type="button"
        onClick={() => useAppStore.getState().toggleSidebar()}
        className={cn(
          railButton,
          "text-text-muted hover:bg-white/5 hover:text-text-secondary titlebar-no-drag",
        )}
        title="Expand sidebar"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => useAppStore.getState().openDashboard()}
        className={cn(
          railButton,
          onDashboard ? "bg-accent/20 text-accent" : "text-text-muted hover:bg-white/5",
        )}
        title="Dashboard"
      >
        <LayoutDashboard className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8px] font-bold text-black">
            {unread}
          </span>
        )}
      </button>
      <div className="my-1 h-px w-6 bg-border" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {projects.map((p) => {
          const live = perProject.live.get(p.id) ?? 0;
          const active = p.id === activeProjectId && !onDashboard;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => useAppStore.getState().setActiveProject(p.id)}
              className={cn(
                railButton,
                "shrink-0",
                active
                  ? "bg-white/10 text-text-primary"
                  : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
              )}
              title={`${p.name}${live ? ` · ${live} running` : ""}${perProject.paused.has(p.id) ? " · suspended sessions" : ""}`}
            >
              <ProjectAvatar project={p} className="h-4 w-4" active={active} />
              <span className="absolute bottom-0 right-0 text-[7px] font-semibold uppercase leading-none text-text-muted">
                {p.name.slice(0, 2)}
              </span>
              {live > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent/80 px-0.5 text-[7px] font-bold text-white">
                  {live}
                </span>
              )}
              {perProject.paused.has(p.id) && (
                <Pause className="absolute bottom-0 left-0 h-2 w-2 text-text-muted" />
              )}
              {perProject.waiting.has(p.id) && (
                <span className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => useAppStore.getState().setActiveProject(null)}
        className={cn(railButton, "text-text-muted hover:bg-white/5 hover:text-text-secondary")}
        title="Add project"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => window.api.settings.open()}
        className={cn(railButton, "text-text-muted hover:bg-white/5 hover:text-text-secondary")}
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  );
}
