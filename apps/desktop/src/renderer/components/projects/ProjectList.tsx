import { type AgentStatus, LIVE_STATUSES, type Project, type ProjectGroup } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { ArrowLeft, Clock, Cuboid, GitBranch, Pause, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useProjectGroups } from "../../hooks/use-trpc-project-groups";
import { formatTimeAgoLong } from "../../lib/format";
import { shortcutLabel, useProjectShortcuts } from "../../lib/live-tabs";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { ProjectAvatar } from "../common/ProjectAvatar";
import { ProjectChip } from "../common/ProjectChip";
import { StatusDot } from "../common/StatusDot";
import { AddProjectDialog } from "./AddProjectDialog";

interface LiveCounts {
  running: number;
  waiting: number;
  idle: number;
}

const EMPTY_COUNTS: LiveCounts = { running: 0, waiting: 0, idle: 0 };

function useLiveCounts(): Map<string, LiveCounts> {
  const agents = useAgentStore((s) => s.agents);
  return useMemo(() => {
    const byProject = new Map<string, LiveCounts>();
    for (const a of Object.values(agents)) {
      if (!LIVE_STATUSES.has(a.status) || a.cliType === "shell") continue;
      const c = byProject.get(a.projectId) ?? { ...EMPTY_COUNTS };
      if (a.status === "waiting_input") c.waiting++;
      else if (!a.suspended && (a.status === "running" || a.status === "spawning")) c.running++;
      else c.idle++;
      byProject.set(a.projectId, c);
    }
    return byProject;
  }, [agents]);
}

const shortPath = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
};

function LiveCount({
  status,
  count,
  label,
}: {
  status: AgentStatus;
  count: number;
  label: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1.5 text-text-secondary">
      <StatusDot status={status} size="sm" />
      {count} {label}
    </span>
  );
}

function ProjectCard({
  project,
  group,
  live,
  shortcut,
  current,
}: {
  project: Project;
  group: ProjectGroup | undefined;
  live: LiveCounts;
  shortcut: string | null;
  current: boolean;
}) {
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const tint = project.color ?? "var(--accent)";

  return (
    <button
      type="button"
      onClick={() => setActiveProject(project.id)}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-bg-secondary p-4 text-left transition-all",
        "hover:border-[var(--accent)]/50 hover:bg-white/[0.02]",
        current ? "border-[var(--accent)]/60" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `color-mix(in srgb, ${tint} 15%, transparent)` }}
        >
          <ProjectAvatar project={project} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-text-primary">{project.name}</h3>
          <p className="truncate text-xs text-text-muted" title={project.path}>
            {shortPath(project.path)}
          </p>
        </div>
        {shortcut && (
          <kbd
            className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
            title="Jumps to its live tab"
          >
            {shortcut}
          </kbd>
        )}
      </div>

      <div className="flex min-h-4 flex-wrap items-center gap-3 text-[11px]">
        <LiveCount status="running" count={live.running} label="running" />
        <LiveCount status="waiting_input" count={live.waiting} label="waiting for input" />
        {live.idle > 0 && (
          <span className="flex items-center gap-1 text-text-muted">
            <Pause className="h-3 w-3" />
            {live.idle} idle
          </span>
        )}
        {live.running + live.waiting + live.idle === 0 && (
          <span className="text-text-muted">No live agents</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
        {group && <ProjectChip project={group} className="text-[10px]" />}
        <span className="flex min-w-0 items-center gap-1">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate">{project.defaultBranch}</span>
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTimeAgoLong(project.lastOpenedAt)}
        </span>
      </div>
    </button>
  );
}

export function ProjectList() {
  const { data: projects, isLoading, isError } = useProjects();
  const { data: groups } = useProjectGroups();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const projectsReturn = useAppStore((s) => s.projectsReturn);
  const closeProjects = useAppStore((s) => s.closeProjects);
  const liveCounts = useLiveCounts();
  const shortcuts = useProjectShortcuts();
  const canGoBack = projectsReturn !== null;

  // Radix dialogs preventDefault the Esc that closes them, so that one never also leaves the view
  useEffect(() => {
    if (!canGoBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeProjects();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canGoBack, closeProjects]);

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          {canGoBack && (
            <button
              type="button"
              onClick={closeProjects}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
              title="Back to where you were (Esc)"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
              <kbd className="rounded border border-border px-1 font-mono text-[9px]">Esc</kbd>
            </button>
          )}
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Projects</h1>
            <p className="text-xs text-text-muted">Select a project to start working with agents</p>
          </div>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="gap-2 bg-accent text-white">
          <Plus className="h-4 w-4" />
          Add Project
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-text-muted">Loading projects...</p>
          </div>
        )}

        {isError && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-error">Failed to load projects</p>
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="flex h-60 flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-secondary">
              <Cuboid className="h-8 w-8 text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-text-primary">No projects yet</p>
              <p className="mt-1 text-xs text-text-muted">
                Add a git repository to start orchestrating agents
              </p>
            </div>
            <Button onClick={() => setAddDialogOpen(true)} className="gap-2 bg-accent text-white">
              <Plus className="h-4 w-4" />
              Add Your First Project
            </Button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                group={groups?.find((g) => g.id === project.groupId)}
                live={liveCounts.get(project.id) ?? EMPTY_COUNTS}
                shortcut={shortcutLabel(shortcuts.get(project.id))}
                current={project.id === projectsReturn?.projectId}
              />
            ))}
          </div>
        )}
      </div>

      <AddProjectDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}
