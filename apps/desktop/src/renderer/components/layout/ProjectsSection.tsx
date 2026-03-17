import type { Project } from "@exegol/shared";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@exegol/ui";
import { ChevronDown, ChevronRight, Code2, FolderOpen, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { useOpenInIde, useProjects, useSettings } from "../../hooks/use-trpc";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";

// ─── Agent Mini Card ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500",
  waiting_input: "bg-yellow-500",
  spawning: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-zinc-500",
  idle: "bg-zinc-500",
  paused: "bg-zinc-500",
};

function AgentMiniCard({ agent }: { agent: AgentState }) {
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const isFocused = focusedAgentId === agent.id;
  const isActive = ["running", "spawning", "waiting_input"].includes(agent.status);

  return (
    <button
      type="button"
      onClick={() => setFocusedAgent(agent.id)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] transition-colors",
        isFocused
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          STATUS_COLORS[agent.status] ?? "bg-zinc-500",
          isActive && "animate-status-pulse",
        )}
      />
      <span className="flex-1 truncate">{agent.taskDescription}</span>
    </button>
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
          {/* Git info + Open in IDE */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <GitBranch className="h-2.5 w-2.5" />
              <span>{project.defaultBranch}</span>
            </div>
            <OpenInIdeButton projectId={project.id} />
          </div>

          {/* Agents: all active + last 3 inactive */}
          {agents.length > 0 ? (
            (() => {
              const active = agents.filter((a) =>
                ["running", "spawning", "waiting_input"].includes(a.status),
              );
              const inactive = agents
                .filter((a) => !["running", "spawning", "waiting_input"].includes(a.status))
                .slice(0, 3);
              const visible = [...active, ...inactive];
              const hidden = agents.length - visible.length;
              return (
                <>
                  {visible.map((agent) => (
                    <AgentMiniCard key={agent.id} agent={agent} />
                  ))}
                  {hidden > 0 && (
                    <p className="py-0.5 text-[10px] text-text-muted">+{hidden} more</p>
                  )}
                </>
              );
            })()
          ) : (
            <p className="py-1 text-[10px] italic text-text-muted">No agents</p>
          )}
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
            openInIde.mutate({
              projectId,
              ide: settings?.defaultIde,
              customPath: settings?.customIdePath ?? undefined,
            });
          }}
          className="rounded p-0.5 text-text-muted hover:bg-white/5 hover:text-text-secondary"
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
  const agents = useAgentStore((s) => s.agents);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Auto-expand the active project
  useEffect(() => {
    if (activeProjectId) {
      setExpandedIds((prev) => {
        if (prev.has(activeProjectId)) return prev;
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
    }
  }, [activeProjectId]);

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

  const agentList = Object.values(agents);

  return (
    <div className="space-y-0.5">
      {projects && projects.length > 0 ? (
        projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={project.id === activeProjectId}
            isExpanded={expandedIds.has(project.id)}
            onSelect={() => setActiveProject(project.id)}
            onToggle={() => toggleProject(project.id)}
            agents={agentList.filter((a) => a.projectId === project.id)}
          />
        ))
      ) : (
        <p className="py-2 text-center text-xs text-text-muted">No projects yet</p>
      )}
    </div>
  );
}
