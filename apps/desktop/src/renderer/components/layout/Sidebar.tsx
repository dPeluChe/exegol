import { cn, Separator } from "@exegol/ui";
import { Activity, Cuboid, LayoutDashboard, Plus } from "lucide-react";
import { useProjects } from "../../hooks/use-trpc";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { AttentionSection } from "./AttentionSection";
import { ProjectsSection } from "./ProjectsSection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSection } from "./SidebarSection";

/** Enough for the section header and one row */
const MIN_PROJECTS_HEIGHT = 56;

export function Sidebar() {
  const { data: projects } = useProjects();
  const projectCount = projects?.length ?? 0;
  const attentionCount = useAgentStore((s) => s.unreadAttentionCount);
  const onDashboard = useAppStore((s) => s.activeView === "dashboard");
  const openDashboard = useAppStore((s) => s.openDashboard);
  const runningCount = useAgentStore(
    (s) =>
      Object.values(s.agents).filter(
        (a) => a.status === "running" || a.status === "spawning" || a.status === "waiting_input",
      ).length,
  );
  const projectsHeight = useAppStore((s) => s.sidebarProjectsHeight);
  const agentBadge =
    attentionCount > 0 ? attentionCount : runningCount > 0 ? runningCount : undefined;

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
        {attentionCount > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            {attentionCount}
          </span>
        )}
        {/* Right edge, like the ⌘n of the tab groups */}
        <kbd
          className={cn(
            "shrink-0 rounded border border-border px-1 font-mono text-[9px] font-normal text-text-muted",
            attentionCount === 0 && "ml-auto",
          )}
        >
          ⌘1
        </kbd>
      </button>

      {/* Live work first: Agents fills the top; Projects sits at the bottom, above the reference
          sections (SidebarFooter), sized to its content or to the height the user dragged */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* T57: Agent monitor — running agents + attention inbox */}
        <SidebarSection
          title="Agents"
          icon={Activity}
          defaultOpen={true}
          count={agentBadge}
          size="fill"
        >
          <AttentionSection />
        </SidebarSection>

        <SectionResizeHandle />

        <SidebarSection
          title="Projects"
          icon={Cuboid}
          defaultOpen={true}
          count={projectCount}
          size="cap"
          height={projectsHeight}
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
      </div>

      <Separator className="bg-border" />

      <SidebarFooter />
    </div>
  );
}

/** Drag between Agents and Projects: up makes Projects taller, down shorter; Agents takes the
 *  rest. Double-click (or Enter) sizes Projects to its content again; arrow keys nudge it */
function SectionResizeHandle() {
  const setHeight = useAppStore((s) => s.setSidebarProjectsHeight);
  const projectsBox = (el: HTMLElement) => el.nextElementSibling?.getBoundingClientRect().height;
  const clamp = (h: number) => Math.max(MIN_PROJECTS_HEIGHT, Math.round(h));

  const startResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    const startHeight = projectsBox(e.currentTarget);
    if (startHeight === undefined || e.button !== 0) return;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => setHeight(clamp(startHeight - (ev.clientY - startY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = projectsBox(e.currentTarget);
    if (current === undefined) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHeight(clamp(current + (e.key === "ArrowUp" ? 16 : -16)));
    }
  };

  return (
    <button
      type="button"
      aria-label="Resize Agents and Projects"
      title="Drag (or arrow keys) to resize Projects; double-click or Enter to fit its content"
      onPointerDown={startResize}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setHeight(null)}
      onClick={(e) => {
        // Enter or Space on the focused handle; a mouse click is a drag start, not a reset
        if (e.detail === 0) setHeight(null);
      }}
      className="group mx-3 mt-auto flex h-2 shrink-0 cursor-row-resize items-center focus-visible:outline-none"
    >
      <span className="h-px w-full bg-border transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent" />
    </button>
  );
}
