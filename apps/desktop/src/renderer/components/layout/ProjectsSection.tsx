import type { Project, Worktree } from "@exegol/shared";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@exegol/ui";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type PortInfo,
  useOpenInIde,
  useProjectPorts,
  useProjects,
  useSettings,
} from "../../hooks/use-trpc";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { findFirstPaneId, useWorkspaceStore } from "../../stores/workspace";
import { AgentLauncher } from "../agents/AgentLauncher";
import { AgentIcon } from "../common/AgentIcon";
import { ConfirmDialog } from "../common/ConfirmDialog";

// ─── Agent Mini Card ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500",
  waiting_input: "bg-yellow-500",
  spawning: "bg-blue-500",
  crashed: "bg-red-500",
};

/** Only show agents that are active or crashed (recoverable) */
const VISIBLE_STATUSES = new Set(["running", "spawning", "waiting_input", "crashed"]);

function formatTimeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function AgentMiniCard({ agent }: { agent: AgentState }) {
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const isFocused = focusedAgentId === agent.id;
  const isActive = ["running", "spawning", "waiting_input"].includes(agent.status);
  const isCrashed = agent.status === "crashed";

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu, closeContextMenu]);

  const handleRemove = useCallback(async () => {
    closeContextMenu();
    try {
      trpcMutate("agents.stop", { id: agent.id }).catch(() => {});
      await trpcMutate("agents.delete", { id: agent.id });
      removeAgent(agent.id);
      const ws = useWorkspaceStore.getState();
      for (const [paneId, pane] of Object.entries(ws.panes)) {
        if (pane.agentId === agent.id) {
          ws.updatePane(paneId, { type: "empty", agentId: undefined });
        }
      }
    } catch (err) {
      console.error("[AgentMiniCard] Failed to delete agent:", err);
    }
  }, [agent.id, removeAgent, closeContextMenu]);

  // Display name: task description or provider name
  const displayName =
    agent.taskDescription && agent.taskDescription !== agent.cliType
      ? agent.taskDescription.slice(0, 40)
      : agent.cliType;

  const handleNavigate = () => {
    setFocusedAgent(agent.id);
    navigateToAgent(agent.id);
  };

  return (
    <div
      role="none"
      className={cn(
        "relative flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
        isFocused
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
      onContextMenu={handleContextMenu}
    >
      <button
        type="button"
        onClick={handleNavigate}
        className="flex flex-1 items-center gap-2 text-left"
      >
        {/* Provider icon (mini) */}
        <AgentIcon
          provider={agent.cliType}
          size={16}
          fallbackColor={STATUS_COLORS[agent.status] ?? "#6B7280"}
        />

        {/* Name + step */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_COLORS[agent.status] ?? "bg-zinc-500",
                isActive && "animate-status-pulse",
              )}
            />
            <span className="flex-1 truncate text-[10px] font-medium">{displayName}</span>
            {agent.tokenUsage.cost > 0 && (
              <span className="shrink-0 text-[8px] tabular-nums text-accent">
                $
                {agent.tokenUsage.cost < 0.01
                  ? agent.tokenUsage.cost.toFixed(4)
                  : agent.tokenUsage.cost.toFixed(2)}
              </span>
            )}
            <span className="shrink-0 text-[8px] tabular-nums text-text-muted">
              {formatTimeAgo(agent.startedAt)}
            </span>
          </div>
          {(agent.currentStep || isCrashed) && (
            <p
              className={cn(
                "truncate text-[9px] pl-2.5",
                isCrashed ? "text-red-400" : "text-text-muted",
              )}
            >
              {isCrashed ? "Crashed — click to re-launch" : agent.currentStep}
            </p>
          )}
        </div>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-bg-secondary py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={handleRemove}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 transition-colors hover:bg-white/10"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Port Badges ─────────────────────────────────────────────────────────────

function PortBadges({ projectPath }: { projectPath: string }) {
  const { data: ports } = useProjectPorts(projectPath);

  if (!ports || ports.length === 0) return null;

  // Deduplicate by port number, prefer runtime over config
  const uniquePorts = new Map<number, PortInfo>();
  for (const p of ports) {
    const existing = uniquePorts.get(p.port);
    if (!existing || (p.source === "runtime" && existing.source === "config")) {
      uniquePorts.set(p.port, p);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5">
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

// ─── Project Item ─────────────────────────────────────────────────────────────

/** Navigate to an agent's terminal in the workspace */
function navigateToAgent(agentId: string): void {
  window.dispatchEvent(new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }));
  const store = useWorkspaceStore.getState();
  const activeTab = store.getActiveTab();
  if (activeTab) {
    const paneId = findFirstPaneId(activeTab.layout);
    if (paneId) store.updatePane(paneId, { type: "terminal", agentId });
  }
  useAgentStore.getState().setFocusedAgent(agentId);
}

/** Branch group: shows branch name + agents + actions for worktrees */
function BranchGroup({
  branchName,
  agents,
  isWorktree,
  worktree,
  projectId,
  onWorktreeDeleted,
}: {
  branchName: string;
  agents: AgentState[];
  isWorktree: boolean;
  worktree?: Worktree;
  projectId: string;
  onWorktreeDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleViewChanges = () => {
    if (!worktree) return;
    window.dispatchEvent(
      new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
    );
    const store = useWorkspaceStore.getState();
    const activeTab = store.getActiveTab();
    if (!activeTab) return;
    const layout = activeTab.layout;
    const paneId = findFirstPaneId(layout);
    if (paneId) store.updatePane(paneId, { type: "files", filePath: worktree.path });
  };

  const handleDeleteConfirmed = async () => {
    if (!worktree || deleting) return;
    setDeleting(true);
    try {
      await trpcMutate("projects.deleteWorktree", {
        worktreeId: worktree.id,
        projectId,
        force: true,
      });
      onWorktreeDeleted?.();
    } catch {
      /* */
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-0.5">
      <div className="group/branch flex items-center gap-1.5 px-1 py-0.5 text-[9px] text-text-muted">
        <GitBranch
          className={cn(
            "h-2.5 w-2.5 shrink-0",
            isWorktree ? "text-accent/60" : "text-text-muted/50",
          )}
        />
        <span className="flex-1 truncate font-medium">{branchName}</span>
        {isWorktree && worktree && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/branch:opacity-100">
            <button
              type="button"
              onClick={handleViewChanges}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
              title="Browse files"
            >
              <FolderOpen className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
                );
                const store = useWorkspaceStore.getState();
                const activeTab = store.getActiveTab();
                if (activeTab) {
                  const paneId = findFirstPaneId(activeTab.layout);
                  if (paneId && worktree) {
                    store.updatePane(paneId, { type: "git", filePath: worktree.path });
                  }
                }
              }}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-accent"
              title="Git status"
            >
              <GitBranch className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-red-400/20 hover:text-red-400"
              title="Delete worktree"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        )}
      </div>
      {agents.map((agent) => (
        <AgentMiniCard key={agent.id} agent={agent} />
      ))}

      {isWorktree && worktree && (
        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title="Delete Worktree"
          description={`This will permanently delete the branch "${branchName}" and all files at:\n${worktree.path}\n\nThis action cannot be undone.`}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          variant="destructive"
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}

// ─── Project Item ─────────────────────────────────────────────────────────────

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  agents: AgentState[];
}

function ProjectItem({
  project,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  agents,
}: ProjectItemProps) {
  const runningCount = agents.filter((a) =>
    ["running", "spawning", "waiting_input"].includes(a.status),
  ).length;

  // Fetch worktrees from DB for this project
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  useEffect(() => {
    if (!isExpanded) return;
    trpcInvoke<Worktree[]>("projects.listWorktrees", { projectId: project.id })
      .then(setWorktrees)
      .catch(() => {});
  }, [isExpanded, project.id]);

  return (
    <div>
      {/* Project row */}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          isSelected ? "bg-white/10 text-text-primary" : "text-text-secondary hover:bg-white/5",
        )}
      >
        {/* Expand/collapse chevron — span to avoid nested button */}
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

        {/* Folder icon */}
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />

        {/* Project name */}
        <span className="flex-1 truncate font-medium">{project.name}</span>

        {/* Running agent count badge */}
        {runningCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] text-accent">
            {runningCount}
          </span>
        )}
      </button>

      {/* Expanded content: branch info + open in IDE + agents */}
      {isExpanded && (
        <div className="ml-5 border-l border-border/50 pl-2">
          {/* Git info + actions (IDE + Launch Agent) */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <GitBranch className="h-2.5 w-2.5" />
              <span>{project.defaultBranch}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <AgentLauncher projectId={project.id} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent("exegol:switch-section", { detail: { section: "pipelines" } }),
                  );
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-accent/20 hover:text-accent"
                title="Pipelines"
              >
                <Layers className="h-3 w-3" />
              </button>
              <OpenInIdeButton projectId={project.id} />
            </div>
          </div>

          {/* Detected ports */}
          <PortBadges projectPath={project.path} />

          {/* Branches: worktrees + agents grouped */}
          {(() => {
            const visible = agents.filter((a) => VISIBLE_STATUSES.has(a.status));

            // Group agents by branch
            const mainAgents = visible.filter((a) => !a.branchName);
            const branchAgentMap = new Map<string, AgentState[]>();
            for (const a of visible) {
              if (a.branchName) {
                const list = branchAgentMap.get(a.branchName) ?? [];
                list.push(a);
                branchAgentMap.set(a.branchName, list);
              }
            }

            // Collect all worktree branches (even without active agents)
            const worktreeBranches = new Set(worktrees.map((wt) => wt.branchName));

            // Merge: worktrees + agent branches
            const allBranches = new Set([...worktreeBranches, ...branchAgentMap.keys()]);

            return (
              <>
                {mainAgents.length > 0 && (
                  <BranchGroup
                    branchName={project.defaultBranch}
                    agents={mainAgents}
                    isWorktree={false}
                    projectId={project.id}
                  />
                )}
                {Array.from(allBranches).map((branch) => (
                  <BranchGroup
                    key={branch}
                    branchName={branch}
                    agents={branchAgentMap.get(branch) ?? []}
                    isWorktree={true}
                    worktree={worktrees.find((wt) => wt.branchName === branch)}
                    projectId={project.id}
                    onWorktreeDeleted={() => {
                      setWorktrees((prev) => prev.filter((wt) => wt.branchName !== branch));
                    }}
                  />
                ))}
                {visible.length === 0 && worktrees.length === 0 && (
                  <p className="py-1 text-[10px] italic text-text-muted">No agents</p>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Open in IDE Button ──────────────────────────────────────────────────────

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

// ─── Projects Section ─────────────────────────────────────────────────────────

interface ProjectsSectionProps {
  onAddProject: () => void;
}

export function ProjectsSection({ onAddProject: _onAddProject }: ProjectsSectionProps) {
  const { data: projects } = useProjects();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  // Use agent store version to force re-render only when store changes
  const agents = useAgentStore((s) => s.agents);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Derive effective expanded IDs: always include the active project (Rule 1: derive, don't sync)
  const effectiveExpandedIds = useMemo(() => {
    const ids = new Set(expandedIds);
    if (activeProjectId) ids.add(activeProjectId);
    return ids;
  }, [expandedIds, activeProjectId]);

  const toggleProject = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {projects && projects.length > 0 ? (
        projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={project.id === activeProjectId}
            isExpanded={effectiveExpandedIds.has(project.id)}
            onSelect={() => setActiveProject(project.id)}
            onToggle={() => toggleProject(project.id)}
            agents={Object.values(agents).filter((a) => a.projectId === project.id)}
          />
        ))
      ) : (
        <p className="py-2 text-center text-xs text-text-muted">No projects yet</p>
      )}
    </div>
  );
}
