import type { Project, Worktree } from "@exegol/shared";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@exegol/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  GitBranch,
  Globe,
  Layers,
  Palette,
  Pause,
  Pencil,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type PortInfo,
  useDeleteProject,
  useOpenInIde,
  useProjectPorts,
  useSettings,
  useWorktrees,
} from "../../hooks/use-trpc";
import { switchSection } from "../../lib/switch-section";
import type { AgentState } from "../../stores/agents";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentLauncher } from "../agents/AgentLauncher";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { ProjectAvatar } from "../common/ProjectAvatar";
import { AgentMiniCard, VISIBLE_STATUSES } from "./AgentMiniCard";
import { BranchGroup } from "./BranchGroup";
import { ProjectAppearanceDialog } from "./ProjectAppearanceDialog";
import { ProjectFiles } from "./ProjectFiles";
import { TabsOverview } from "./TabsOverview";

function PortBadges({ projectPath }: { projectPath: string }) {
  const { data: ports } = useProjectPorts(projectPath);

  if (!ports || ports.length === 0) return null;

  const uniquePorts = new Map<number, PortInfo>();
  for (const p of ports) {
    const existing = uniquePorts.get(p.port);
    if (!existing || (p.source === "runtime" && existing.source === "config")) {
      uniquePorts.set(p.port, p);
    }
  }

  return (
    <div className="ml-1 flex min-w-0 flex-wrap items-center gap-1">
      <Globe className="h-2.5 w-2.5 text-text-muted" />
      {Array.from(uniquePorts.values()).map((p) => (
        <button
          key={p.port}
          type="button"
          onClick={() => window.open(`http://localhost:${p.port}`, "_blank")}
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] transition-colors hover:bg-white/10",
            p.source === "runtime" ? "text-green-400" : "text-text-muted",
          )}
          title={
            p.source === "runtime"
              ? `PID ${(p as { pid: number }).pid} (${(p as { process: string }).process})`
              : `From ${(p as { file: string }).file}`
          }
        >
          <span
            className={cn(
              "h-1 w-1 rounded-full",
              p.source === "runtime" ? "bg-green-500" : "bg-zinc-500",
            )}
          />
          {p.port}
        </button>
      ))}
    </div>
  );
}

function OpenInIdeButton({ projectId }: { projectId: string }) {
  const { data: settings } = useSettings();
  const openInIde = useOpenInIde();
  const ideName = settings?.defaultIde ?? "vscode";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openInIde.mutate(
              {
                projectId,
                ide: settings?.defaultIde,
                customPath: settings?.customIdePath ?? undefined,
              },
              { onError: (err) => console.error("[IDE] Open failed:", err) },
            );
          }}
          className="rounded p-0.5 text-text-muted hover:bg-white/5 hover:text-text-secondary"
          title={`Open in ${ideName}`}
        >
          <Code2 className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>Open in {ideName}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRename: (id: string, name: string) => void;
  agents: AgentState[];
  /** Drag-and-drop index */
  index: number;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (index: number) => void;
}

export function ProjectItem({
  project,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  onRename,
  agents,
  index,
  onDragStart,
  onDragOver,
  onDrop,
}: ProjectItemProps) {
  const live = agents.filter((a) => ["running", "spawning", "waiting_input"].includes(a.status));
  // A suspended session still reads as running: counted apart so it is easy to spot
  const pausedCount = live.filter((a) => a.suspended).length;
  const runningCount = live.length - pausedCount;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useSettings();
  const openInIde = useOpenInIde();
  const deleteProject = useDeleteProject();

  const { data: worktrees = [] } = useWorktrees(project.id, isExpanded);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Kept inside the window: a right-click near the bottom opened it half off-screen
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 150),
    });
  }, []);

  const submitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(project.id, trimmed);
    }
    setEditing(false);
  }, [editName, project.id, project.name, onRename]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: draggable project item
    <section
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      className="cursor-grab active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditName(project.name);
          setEditing(true);
        }}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          isSelected ? "bg-white/10 text-text-primary" : "text-text-secondary hover:bg-white/5",
        )}
      >
        <span
          role="none"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onToggle();
            }
          }}
          className="shrink-0"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>

        <ProjectAvatar project={project} />

        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            className="w-0 min-w-0 flex-1 rounded bg-bg-tertiary px-1 py-0 text-xs text-text-primary outline-none ring-1 ring-accent/50"
          />
        ) : (
          <span className="flex-1 truncate font-medium">{project.name}</span>
        )}

        {pausedCount > 0 && (
          <span
            className="flex h-4 items-center gap-0.5 rounded-full bg-white/5 px-1 text-[10px] text-text-muted"
            title={`${pausedCount} suspended session${pausedCount === 1 ? "" : "s"}`}
          >
            <Pause className="h-2.5 w-2.5" />
            {pausedCount > 1 && pausedCount}
          </span>
        )}
        {runningCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] text-accent">
            {runningCount}
          </span>
        )}
      </button>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-bg-secondary py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setEditName(project.name);
              setEditing(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setAppearanceOpen(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
          >
            <Palette className="h-3 w-3" />
            Edit name, icon and color...
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              openInIde.mutate(
                {
                  projectId: project.id,
                  ide: settings?.defaultIde,
                  customPath: settings?.customIdePath ?? undefined,
                },
                { onError: (err) => console.error("[IDE] Open failed:", err) },
              );
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
          >
            <ExternalLink className="h-3 w-3" />
            Open in IDE
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setConfirmRemove(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 transition-colors hover:bg-white/10"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="ml-5 border-l border-border/50 pl-2">
          <div className="flex items-center justify-between gap-1 py-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-muted">
              <GitBranch className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{project.defaultBranch}</span>
              <PortBadges projectPath={project.path} />
            </div>
            <div className="flex items-center gap-0.5">
              <AgentLauncher projectId={project.id} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  switchSection("pipelines");
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-accent/20 hover:text-accent"
                title="Pipelines"
              >
                <Layers className="h-3 w-3" />
              </button>
              <OpenInIdeButton projectId={project.id} />
            </div>
          </div>

          <TabsOverview projectId={project.id} />

          <ProjectFiles projectId={project.id} path={project.path} />

          <ProjectAgentGroups project={project} agents={agents} worktrees={worktrees} />
        </div>
      )}
      {/* Mounted only while open: one per project row kept a dialog and its hooks alive for nothing */}
      {appearanceOpen && (
        <ProjectAppearanceDialog
          project={project}
          open
          onOpenChange={setAppearanceOpen}
          onRename={(name) => onRename(project.id, name)}
        />
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove project"
        description={`Remove "${project.name}" from Exegol? Its session history, scores and memories are deleted. Files on disk are not touched.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() =>
          deleteProject.mutate(project.id, {
            onError: (err) => console.error("[Project] Delete failed:", err),
          })
        }
      />
    </section>
  );
}

/**
 * What the tabs don't show: worktree branches with their agents, then agents
 * open in no pane at all. An agent already in a tab is listed there only.
 */
function ProjectAgentGroups({
  project,
  agents,
  worktrees,
}: {
  project: Project;
  agents: AgentState[];
  worktrees: Worktree[];
}) {
  // Primitive selectors: a cwd or focus change in the workspace re-rendered the whole row
  const paneAgentKey = useWorkspaceStore((s) =>
    Object.values(s.projectWorkspaces[project.id]?.panes ?? {})
      .flatMap((p) => (p.agentId ? [p.agentId] : []))
      .sort()
      .join(","),
  );
  const hasTabs = useWorkspaceStore((s) => !!s.projectWorkspaces[project.id]?.tabs.length);
  const paneAgentIds = useMemo(() => new Set(paneAgentKey.split(",")), [paneAgentKey]);
  const queryClient = useQueryClient();
  const visible = agents.filter((a) => VISIBLE_STATUSES.has(a.status));
  const offTab = visible.filter((a) => !paneAgentIds.has(a.id));
  const loose = offTab.filter((a) => !a.branchName);
  const byBranch = new Map<string, AgentState[]>();
  for (const a of offTab) {
    if (a.branchName) byBranch.set(a.branchName, [...(byBranch.get(a.branchName) ?? []), a]);
  }
  const branches = new Set([...worktrees.map((wt) => wt.branchName), ...byBranch.keys()]);

  return (
    <>
      {Array.from(branches).map((branch) => (
        <BranchGroup
          key={branch}
          branchName={branch}
          agents={byBranch.get(branch) ?? []}
          worktree={worktrees.find((wt) => wt.branchName === branch)}
          projectId={project.id}
          onWorktreeDeleted={() => {
            queryClient.invalidateQueries({ queryKey: ["worktrees", project.id] });
          }}
        />
      ))}
      {loose.length > 0 && (
        <div className="space-y-px">
          <p className="px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Not open in a tab
          </p>
          {loose.map((a) => (
            <AgentMiniCard key={a.id} agent={a} />
          ))}
        </div>
      )}
      {visible.length === 0 && worktrees.length === 0 && !hasTabs && (
        <p className="py-1 text-[10px] italic text-text-muted">No agents</p>
      )}
    </>
  );
}
