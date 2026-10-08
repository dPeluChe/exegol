import { cn, Separator } from "@exegol/ui";
import { ArrowDownAZ, GripVertical, LayoutDashboard, Plus } from "lucide-react";
import { useProjects } from "../../hooks/use-trpc";
import { chordBadge } from "../../lib/keymap";
import { useSidebarCounts } from "../../lib/sidebar-views";
import { type SidebarView, useAppStore } from "../../stores/app";
import { SegmentedTabs } from "../common/SegmentedTabs";
import { ProjectsSection } from "./ProjectsSection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { AgentsView, AttentionView } from "./SidebarViews";

const PANEL_ID = "sidebar-view";

const toolButton =
  "flex h-5 items-center justify-center gap-1 rounded px-1 text-[9px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-secondary";

export function Sidebar() {
  const { data: projects } = useProjects();
  const projectCount = projects?.length ?? 0;
  const { live: liveCount, attention: attentionCount, unread: unreadCount } = useSidebarCounts();
  const onDashboard = useAppStore((s) => s.activeView === "dashboard");
  const openDashboard = useAppStore((s) => s.openDashboard);
  const view = useAppStore((s) => s.sidebarView);
  const setView = useAppStore((s) => s.setSidebarView);

  return (
    // clip, not hidden: focusing a too-wide input scrolled a hidden box sideways and it stayed shifted
    <div className="flex h-full flex-col overflow-x-clip bg-bg-secondary">
      <SidebarHeader />

      {/* Exegol's main view (Antonio 2026-08-11): the cross-project fleet
          dashboard sits above everything — one click from anywhere. */}
      <button
        type="button"
        onClick={openDashboard}
        className={cn(
          "mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors",
          onDashboard
            ? "border-accent/60 bg-accent/20"
            : "border-border bg-transparent text-text-secondary hover:bg-white/5",
        )}
      >
        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 truncate">Dashboard</span>
        {unreadCount > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            {unreadCount}
          </span>
        )}
        {/* Right edge, like the ⌘n of the tab groups */}
        <kbd
          className={cn(
            "shrink-0 rounded border border-border px-1 font-mono text-[9px] font-normal text-text-muted",
            unreadCount === 0 && "ml-auto",
          )}
        >
          {chordBadge("1")}
        </kbd>
      </button>

      {/* One view at a time, each with the full height; a new attention item never switches
          the view, its count is the signal */}
      <div className="mx-3 mt-2 shrink-0">
        <SegmentedTabs<SidebarView>
          compact
          label="Sidebar view"
          panelId={PANEL_ID}
          active={view}
          onChange={setView}
          tabs={[
            { id: "agents", label: "Agents", count: liveCount || undefined },
            { id: "projects", label: "Projects", count: projectCount || undefined },
            {
              id: "attention",
              label: "Needs attention",
              count: attentionCount || undefined,
              alert: unreadCount > 0,
            },
          ]}
        />
      </div>

      <ViewToolbar view={view} />

      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`${PANEL_ID}-${view}`}
        className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-2"
      >
        {view === "agents" && <AgentsView />}
        {view === "projects" && <ProjectsSection />}
        {view === "attention" && <AttentionView />}
      </div>

      <Separator className="bg-border" />

      <SidebarFooter />
    </div>
  );
}

/** The current view's own actions, right-aligned under the selector */
function ViewToolbar({ view }: { view: SidebarView }) {
  const activeOnly = useAppStore((s) => s.sidebarActiveOnly);
  const setActiveOnly = useAppStore((s) => s.setSidebarActiveOnly);
  const projectsOrder = useAppStore((s) => s.projectsOrder);
  const setProjectsOrder = useAppStore((s) => s.setProjectsOrder);

  if (view === "attention") return null;
  return (
    <div className="mx-3 mt-1 flex shrink-0 items-center justify-end gap-0.5">
      {view === "agents" && (
        <button
          type="button"
          aria-pressed={activeOnly}
          onClick={() => setActiveOnly(!activeOnly)}
          className={cn(toolButton, activeOnly && "bg-accent/15 text-accent hover:text-accent")}
          title="Show only the sessions working now or waiting on you"
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              activeOnly ? "bg-accent" : "bg-text-muted/50",
            )}
          />
          Active only
        </button>
      )}
      {view === "projects" && (
        <>
          <button
            type="button"
            onClick={() => setProjectsOrder(projectsOrder === "auto" ? "manual" : "auto")}
            className={toolButton}
            aria-label={projectsOrder === "auto" ? "Auto order" : "Ordered by hand"}
            title={
              projectsOrder === "auto"
                ? "Auto order: Cmd+n first, then live, then A-Z. Click to order by hand"
                : "Ordered by hand (drag). Click for auto order"
            }
          >
            {projectsOrder === "auto" ? (
              <ArrowDownAZ className="h-3 w-3" />
            ) : (
              <GripVertical className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => useAppStore.getState().openProjects()}
            className={toolButton}
            aria-label="Add project"
            title="Add project"
          >
            <Plus className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
