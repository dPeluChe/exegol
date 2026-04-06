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
} from "lucide-react";
import { useEffect, useState } from "react";
import { type PortInfo, useOpenInIde, useProjectPorts, useSettings } from "../../hooks/use-trpc";
import { trpcInvoke } from "../../lib/trpc-client";
import type { AgentState } from "../../stores/agents";
import { AgentLauncher } from "../agents/AgentLauncher";
import { VISIBLE_STATUSES } from "./AgentMiniCard";
import { BranchGroup } from "./BranchGroup";
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
  agents: AgentState[];
}

export function ProjectItem({
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

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  useEffect(() => {
    if (!isExpanded) return;
    trpcInvoke<Worktree[]>("projects.listWorktrees", { projectId: project.id })
      .then(setWorktrees)
      .catch(() => {});
  }, [isExpanded, project.id]);

  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
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

        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />

        <span className="flex-1 truncate font-medium">{project.name}</span>

        {runningCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] text-accent">
            {runningCount}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="ml-5 border-l border-border/50 pl-2">
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

          <PortBadges projectPath={project.path} />

          {(() => {
            const visible = agents.filter((a) => VISIBLE_STATUSES.has(a.status));

            const mainAgents = visible.filter((a) => !a.branchName);
            const branchAgentMap = new Map<string, AgentState[]>();
            for (const a of visible) {
              if (a.branchName) {
                const list = branchAgentMap.get(a.branchName) ?? [];
                list.push(a);
                branchAgentMap.set(a.branchName, list);
              }
            }

            const worktreeBranches = new Set(worktrees.map((wt) => wt.branchName));
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

          {isSelected && <TabsOverview />}
        </div>
      )}
    </div>
  );
}
