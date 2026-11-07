import type { AgentStatus, Project, ProjectGroup, ProjectShape } from "@exegol/shared";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from "@exegol/ui";
import { ArrowLeft, Clock, Cuboid, FolderGit2, GitBranch, Pause, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProjectShapes } from "../../hooks/use-project-shapes";
import { useProjects } from "../../hooks/use-trpc";
import { useProjectGroups } from "../../hooks/use-trpc-project-groups";
import { formatTimeAgo, tailPath } from "../../lib/format";
import { appKeys } from "../../lib/keymap";
import { shortcutLabel, useProjectShortcuts } from "../../lib/live-tabs";
import { isLiveAgent, useAgentStore } from "../../stores/agents";
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

/** Live agents per project. "Waiting" is an unread attention item, as on the rail: a bare
 *  waiting_input is only the end of a turn (T123) */
function useLiveCounts(): Map<string, LiveCounts> {
  const agents = useAgentStore((s) => s.agents);
  const attention = useAgentStore((s) => s.attentionItems);
  return useMemo(() => {
    const byProject = new Map<string, LiveCounts>();
    for (const a of Object.values(agents)) {
      if (!isLiveAgent(a)) continue;
      const c = byProject.get(a.projectId) ?? { ...EMPTY_COUNTS };
      const item = attention[a.id];
      if (item && !item.read) c.waiting++;
      else if (!a.suspended && a.activityLevel === "busy") c.running++;
      else c.idle++;
      byProject.set(a.projectId, c);
    }
    return byProject;
  }, [agents, attention]);
}

function LiveCount({
  status,
  count,
  title,
}: {
  status: AgentStatus;
  count: number;
  title: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1 text-text-secondary" title={title}>
      <StatusDot status={status} size="sm" />
      {count}
    </span>
  );
}

function RepoCount({ shape }: { shape: ProjectShape | undefined }) {
  if (shape?.kind !== "workspace") return null;
  const more = shape.repoCount - shape.repos.length;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-1 rounded border border-border px-1 text-[10px] text-text-secondary">
          <FolderGit2 className="h-3 w-3" />
          {shape.repoCount}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="mb-1 font-medium">
          Workspace, {shape.repoCount} repo{shape.repoCount === 1 ? "" : "s"} inside
        </p>
        {shape.repos.map((folder) => (
          <p key={folder} className="truncate font-mono text-[10px]">
            {folder}
          </p>
        ))}
        {more > 0 && <p className="text-[10px]">and {more} more</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectCard({
  project,
  group,
  live,
  shape,
  shortcut,
  current,
}: {
  project: Project;
  group: ProjectGroup | undefined;
  live: LiveCounts;
  shape: ProjectShape | undefined;
  shortcut: string | null;
  current: boolean;
}) {
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const tint = project.color ?? "var(--accent)";
  const liveTotal = live.running + live.waiting + live.idle;

  return (
    <button
      type="button"
      onClick={() => setActiveProject(project.id)}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-bg-secondary px-3 py-2.5 text-left transition-colors",
        "hover:border-[var(--accent)]/50 hover:bg-white/[0.02]",
        current ? "border-[var(--accent)]/60" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${tint} 15%, transparent)` }}
        >
          <ProjectAvatar project={project} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold text-text-primary">{project.name}</h3>
          <p className="truncate text-[10px] text-text-muted" title={project.path}>
            {tailPath(project.path, 2)}
          </p>
        </div>
        <RepoCount shape={shape} />
        {shortcut && (
          <kbd
            className="shrink-0 rounded border border-border px-1 font-mono text-[9px] text-text-muted"
            title="Opens the project as you left it"
          >
            {shortcut}
          </kbd>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2.5 text-[10px] text-text-muted">
        <LiveCount status="running" count={live.running} title="Working" />
        <LiveCount status="waiting_input" count={live.waiting} title="Waiting for you" />
        {live.idle > 0 && (
          <span className="flex items-center gap-0.5" title="Idle">
            <Pause className="h-2.5 w-2.5" />
            {live.idle}
          </span>
        )}
        {liveTotal === 0 && <span>No live agents</span>}
        {group && <ProjectChip project={group} className="text-[9px]" />}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {shape?.kind === "repo" && (
            <>
              <GitBranch className="h-2.5 w-2.5" />
              <span className="max-w-20 truncate">{project.defaultBranch}</span>
            </>
          )}
          <Clock className="ml-1 h-2.5 w-2.5" />
          {formatTimeAgo(project.lastOpenedAt)}
        </span>
      </div>
    </button>
  );
}

const matches = (p: Project, q: string) =>
  p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);

export function ProjectList() {
  const { data: projects, isLoading, isError } = useProjects();
  const { data: groups } = useProjectGroups();
  const addDialogOpen = useAppStore((s) => s.addProjectOpen);
  const setAddDialogOpen = useAppStore((s) => s.setAddProjectOpen);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const canGoBack = useAppStore((s) => s.projectsFrom !== null || s.activeProjectId !== null);
  const closeProjects = useAppStore((s) => s.closeProjects);
  const liveCounts = useLiveCounts();
  const shortcuts = useProjectShortcuts();
  const groupById = useMemo(() => new Map(groups?.map((g) => [g.id, g])), [groups]);
  const shapes = useProjectShapes();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? (projects ?? []).filter((p) => matches(p, q)) : (projects ?? []);

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
        <div className="flex items-center gap-2">
          {projects && projects.length > 0 && (
            <label className="flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-bg-secondary px-2 text-xs focus-within:border-[var(--accent)]/60">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <input
                // biome-ignore lint/a11y/noAutofocus: the view opens to find a project
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                  }
                  const first = shown[0];
                  if (e.key === "Enter" && q && first)
                    useAppStore.getState().setActiveProject(first.id);
                }}
                placeholder={`Search ${projects.length} projects`}
                className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
              />
            </label>
          )}
          <Button
            onClick={() => setAddDialogOpen(true)}
            className="gap-2 bg-accent text-white"
            title={`Add Project (${appKeys("Cmd+Shift+A")} here)`}
          >
            <Plus className="h-4 w-4" />
            Add Project
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
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

        {projects && projects.length > 0 && shown.length === 0 && (
          <p className="py-10 text-center text-xs text-text-muted">No project matches "{query}"</p>
        )}

        {shown.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
            {shown.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                group={project.groupId ? groupById.get(project.groupId) : undefined}
                live={liveCounts.get(project.id) ?? EMPTY_COUNTS}
                shape={shapes?.[project.id]}
                shortcut={shortcutLabel(shortcuts.get(project.id))}
                current={project.id === activeProjectId}
              />
            ))}
          </div>
        )}
      </div>

      <AddProjectDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}
