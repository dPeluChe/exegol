import { cn } from "@exegol/ui";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Cuboid,
  Eye,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePointerReorder } from "../../hooks/use-pointer-reorder";
import { useProject, useProjects } from "../../hooks/use-trpc";
import {
  groupShortcut,
  type LiveTabGroup,
  reorderKeys,
  useLiveTabGroups,
} from "../../lib/live-tabs";
import {
  type AgentState,
  type AttentionItem,
  type AttentionLevel,
  jumpToAgent,
  useAgentStore,
} from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import { AgentSpinner } from "../common/AgentSpinner";
import { ProjectAvatar } from "../common/ProjectAvatar";
import { ProjectChip, type ProjectMeta } from "../common/ProjectChip";

// ─── Level config ────────────────────────────────────────────────────────

const ATTENTION_LEVEL_ORDER: Record<AttentionLevel, number> = {
  critical: 0,
  action_needed: 1,
  info: 2,
};

const LEVEL_CONFIG: Record<
  AttentionLevel,
  { icon: typeof AlertCircle; dotClass: string; bgClass: string }
> = {
  critical: {
    icon: AlertCircle,
    dotClass: "bg-red-500",
    bgClass: "border-red-500/20 bg-red-500/5",
  },
  action_needed: {
    icon: AlertTriangle,
    dotClass: "bg-amber-500",
    bgClass: "border-amber-500/20 bg-amber-500/5",
  },
  info: {
    icon: CheckCircle,
    dotClass: "bg-blue-400",
    bgClass: "border-blue-400/10 bg-blue-400/5",
  },
};

// ─── Time formatting ─────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function elapsed(startedAt: number | null): string {
  if (!startedAt) return "";
  return timeAgo(startedAt * 1000);
}

// ─── Main Component ──────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["running", "spawning", "waiting_input"]);

export function AttentionSection() {
  const agents = useAgentStore((s) => s.agents);
  // Names alone ("ember", "koi") didn't say which project is waiting
  const { data: projects } = useProjects();
  const projectById = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, { name: p.name, color: p.color ?? null }])),
    [projects],
  );
  const rawItems = useAgentStore((s) => s.attentionItems);
  const dismiss = useAgentStore((s) => s.dismissAttention);
  const togglePin = useAgentStore((s) => s.toggleAttentionPin);
  const clearRead = useAgentStore((s) => s.clearReadAttention);
  const markRead = useAgentStore((s) => s.markAttentionRead);

  // Memoize sorted items to avoid re-sorting on every render
  const attentionItems = useMemo(() => {
    const items = Object.values(rawItems);
    return items.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      const ld = ATTENTION_LEVEL_ORDER[a.level] - ATTENTION_LEVEL_ORDER[b.level];
      if (ld !== 0) return ld;
      return b.timestamp - a.timestamp;
    });
  }, [rawItems]);

  // Force re-render every 10s for elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // Group active agents by project. One already listed under Needs Attention
  // is not repeated below it: same session, two rows, two different names.
  const activeAgents = Object.values(agents).filter(
    (a) => ACTIVE_STATUSES.has(a.status) && !rawItems[a.id],
  );
  // Grouped by workspace tab (layout), in the user's order: the same list Cmd+2..9 walks.
  // A session no pane shows falls back to a per-project group with no shortcut.
  const groups = useLiveTabGroups();
  const setOrder = useAppStore((s) => s.setLiveTabOrder);
  const inGroups = new Set(groups.flatMap((g) => g.agentIds));
  const byProject = new Map<string, AgentState[]>();
  for (const agent of activeAgents) {
    if (inGroups.has(agent.id)) continue;
    const list = byProject.get(agent.projectId) ?? [];
    list.push(agent);
    byProject.set(agent.projectId, list);
  }

  const navigateToAgent = useCallback(
    (agentId: string, projectId: string) => {
      markRead(agentId);
      jumpToAgent(agentId, projectId);
    },
    [markRead],
  );

  const hasRunning = groups.length > 0 || byProject.size > 0;
  // Dropped on the group below it goes after it (inserting before put it back where it was)
  const reorder = usePointerReorder((drag, target) =>
    setOrder(
      reorderKeys(
        groups.map((g) => g.key),
        drag,
        target,
      ),
    ),
  );
  // The tab on screen stands out, and blinks when a Cmd+n jump lands on it
  const activeProjectId = useAppStore((s) =>
    s.activeView === "workspace" ? s.activeProjectId : null,
  );
  const activeTabByProject = useWorkspaceStore((s) =>
    activeProjectId ? s.projectWorkspaces[activeProjectId]?.activeTabId : null,
  );
  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const onFlash = (e: Event) => {
      setFlashKey((e as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFlashKey(null), 700);
    };
    window.addEventListener("exegol:live-tab-flash", onFlash);
    return () => {
      window.removeEventListener("exegol:live-tab-flash", onFlash);
      window.clearTimeout(timer);
    };
  }, []);
  const hasAttention = attentionItems.length > 0;
  const hasRead = attentionItems.some((i) => i.read && !i.pinned);

  if (!hasRunning && !hasAttention) {
    return <p className="py-2 text-center text-[9px] italic text-text-muted">No agents active</p>;
  }

  return (
    <div className="space-y-2">
      {/* Attention FIRST (verify round 3, user request): sessions that need
          you float above the passive running list. */}
      {hasAttention && (
        <div className="space-y-1">
          {hasRunning && (
            <div className="flex items-center gap-2 px-0.5 pt-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/80">
                Needs Attention
              </span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
          )}
          {attentionItems.map((item) => (
            <AttentionCard
              key={item.agentId}
              item={item}
              name={agents[item.agentId]?.alias ?? item.cliType}
              project={projectById.get(item.projectId)}
              onNavigate={() => navigateToAgent(item.agentId, item.projectId)}
              onDismiss={() => dismiss(item.agentId)}
              onTogglePin={() => togglePin(item.agentId)}
            />
          ))}
          {hasRead && (
            <button
              type="button"
              onClick={clearRead}
              className="flex w-full items-center justify-center gap-1 rounded py-1 text-[9px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Clear read
            </button>
          )}
        </div>
      )}

      {hasRunning && (
        <div className="space-y-1.5">
          {groups.map((group, index) => (
            <TabAgentGroup
              key={group.key}
              group={group}
              shortcut={groupShortcut(index)}
              agents={group.agentIds
                .map((id) => agents[id])
                .filter((a): a is AgentState => !!a && !rawItems[a.id])}
              onNavigate={navigateToAgent}
              reorderProps={reorder.itemProps(group.key)}
              dragging={reorder.draggingKey === group.key}
              dropTarget={!!reorder.draggingKey && reorder.overKey === group.key}
              active={group.projectId === activeProjectId && group.tabId === activeTabByProject}
              flashing={flashKey === group.key}
            />
          ))}
          {Array.from(byProject.entries()).map(([projectId, projectAgents]) => (
            <ProjectAgentGroup
              key={projectId}
              projectId={projectId}
              agents={projectAgents}
              onNavigate={navigateToAgent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab Agent Group ─────────────────────────────────────────────────────

function TabAgentGroup({
  group,
  shortcut,
  agents,
  onNavigate,
  reorderProps,
  dragging,
  dropTarget,
  active,
  flashing,
}: {
  group: LiveTabGroup;
  active: boolean;
  flashing: boolean;
  shortcut: string | null;
  /** Its sessions minus those already listed under Needs attention */
  agents: AgentState[];
  onNavigate: (agentId: string, projectId: string) => void;
  /** Press anywhere on the group and move to reorder it (Cmd+2..9 follow this order) */
  reorderProps: ReturnType<ReturnType<typeof usePointerReorder>["itemProps"]>;
  dragging: boolean;
  dropTarget: boolean;
}) {
  const { data: project } = useProject(group.projectId);
  const first = group.agentIds[0];
  return (
    <div
      {...reorderProps}
      className={cn(
        "select-none rounded-lg border bg-bg-tertiary/30 p-1.5 transition-colors",
        active ? "border-accent/60" : "border-border/50",
        flashing && "animate-flash-once",
        dragging && "opacity-50",
        dropTarget && "border-accent ring-1 ring-accent/40",
      )}
    >
      <button
        type="button"
        onClick={() => first && onNavigate(first, group.projectId)}
        className="mb-1 flex w-full min-w-0 cursor-grab items-center gap-1.5 px-0.5 text-left active:cursor-grabbing"
        title="Go to this tab; drag to reorder"
      >
        {project ? (
          <ProjectAvatar project={project} className="h-3 w-3" />
        ) : (
          <Cuboid className="h-3 w-3 shrink-0 text-accent/70" />
        )}
        <span className="min-w-0 truncate text-[10px] font-medium text-text-secondary">
          {project?.name ?? group.projectId.slice(0, 12)}
        </span>
        <span className="min-w-0 truncate text-[9px] text-text-muted">{group.tabLabel}</span>
        {shortcut && (
          <kbd className="ml-auto shrink-0 rounded border border-border px-1 font-mono text-[9px] text-text-muted">
            {shortcut}
          </kbd>
        )}
      </button>
      {agents.length > 0 ? (
        <div className="space-y-0.5">
          {agents.map((agent) => (
            <RunningAgentRow
              key={agent.id}
              agent={agent}
              onClick={() => onNavigate(agent.id, agent.projectId)}
            />
          ))}
        </div>
      ) : (
        <p className="px-0.5 text-[9px] text-text-muted">Waiting on you, see Needs attention</p>
      )}
    </div>
  );
}

// ─── Project Agent Group ─────────────────────────────────────────────────

function ProjectAgentGroup({
  projectId,
  agents,
  onNavigate,
}: {
  projectId: string;
  agents: AgentState[];
  onNavigate: (agentId: string, projectId: string) => void;
}) {
  const { data: project } = useProject(projectId);

  return (
    <div className="rounded-lg border border-border/50 bg-bg-tertiary/30 p-1.5">
      {/* Project header */}
      <div className="mb-1 flex items-center gap-1.5 px-0.5">
        <Cuboid className="h-3 w-3 text-accent/70" />
        <span className="text-[10px] font-medium text-text-secondary">
          {project?.name ?? projectId.slice(0, 12)}
        </span>
        <span className="text-[9px] text-text-muted">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Agent rows */}
      <div className="space-y-0.5">
        {agents.map((agent) => (
          <RunningAgentRow
            key={agent.id}
            agent={agent}
            onClick={() => onNavigate(agent.id, agent.projectId)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Running Agent Row ───────────────────────────────────────────────────

function RunningAgentRow({ agent, onClick }: { agent: AgentState; onClick: () => void }) {
  // waiting_input is just a turn boundary (T123) — the amber warning only
  // belongs to agents with a live UNREAD attention item (verify round 3:
  // the row kept its ⚠ after the user answered the prompt).
  const hasUnreadAttention = useAgentStore((s) => s.isUnread(agent.id));
  const isWaiting = agent.status === "waiting_input" && hasUnreadAttention;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] transition-colors",
        "cursor-pointer hover:bg-white/5",
        isWaiting && "bg-amber-500/5",
      )}
      onClick={onClick}
      title={agent.taskDescription}
    >
      {/* Attention warning / idle dot / busy spinner */}
      {isWaiting ? (
        <AlertTriangle className="h-3 w-3 shrink-0 animate-pulse text-amber-400" />
      ) : agent.status === "waiting_input" ? (
        <span
          className="mx-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-zinc-500"
          aria-hidden="true"
          title="Idle — waiting for your next prompt"
        />
      ) : (
        <AgentSpinner agentId={agent.id} />
      )}

      {/* Provider icon */}
      <AgentIcon provider={agent.cliType} size={14} />

      {/* Agent info */}
      <span className="font-medium text-text-primary">{agent.alias ?? agent.cliType}</span>
      {agent.alias && <span className="text-[10px] text-text-muted">{agent.cliType}</span>}
      <span className="min-w-0 flex-1 truncate text-text-muted">
        {agent.currentStep ?? agent.taskDescription}
      </span>

      {/* Elapsed time */}
      <span className="shrink-0 text-[9px] text-text-muted">{elapsed(agent.startedAt)}</span>
    </button>
  );
}

// ─── Attention Card ──────────────────────────────────────────────────────

function AttentionCard({
  item,
  name,
  project,
  onNavigate,
  onDismiss,
  onTogglePin,
}: {
  item: AttentionItem;
  /** The session's name (alias) — the same one the project list and panes show */
  name: string;
  project: ProjectMeta | undefined;
  onNavigate: () => void;
  onDismiss: () => void;
  onTogglePin: () => void;
}) {
  const config = LEVEL_CONFIG[item.level];
  const LevelIcon = config.icon;

  return (
    <div
      className={cn(
        "group flex items-center rounded-lg border transition-colors",
        item.read ? "border-border/50 opacity-60" : config.bgClass,
        "hover:opacity-100",
      )}
    >
      <button
        type="button"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 pl-2 text-left"
      >
        {/* Level dot */}
        <div className={cn("h-2 w-2 shrink-0 rounded-full", config.dotClass)} />

        {/* Provider icon */}
        <AgentIcon provider={item.cliType} size={14} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-text-primary">{name}</span>
            {project && <ProjectChip project={project} className="py-0 text-[9px]" />}
            {item.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
            {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
            <LevelIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{item.reason}</span>
            <span className="shrink-0">{timeAgo(item.timestamp)}</span>
          </div>
        </div>
      </button>

      {/* Actions (hover) */}
      <div className="flex shrink-0 items-center gap-0.5 py-1.5 pr-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {!item.read && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              useAgentStore.getState().markAttentionRead(item.agentId);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Mark as read"
            aria-label="Mark as read"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title={item.pinned ? "Unpin" : "Pin"}
          aria-label={item.pinned ? "Unpin" : "Pin"}
        >
          {item.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-red-400/80 hover:text-white"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
