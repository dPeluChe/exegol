import { ACTIVE_STATUSES, isSessionReconnecting, reconnectingLabel } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Cuboid,
  Eye,
  Loader2,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { shallow } from "zustand/shallow";
import { useNow } from "../../hooks/use-now";
import { usePointerReorder } from "../../hooks/use-pointer-reorder";
import { useProject, useProjects } from "../../hooks/use-trpc";
import {
  groupByProject,
  type LiveProjectGroup,
  type LiveTabGroup,
  PANELESS_TAB,
  reorderProjectOrder,
  shortcutLabel,
  useLiveTabGroups,
  useProjectShortcuts,
  withPanelessSessions,
} from "../../lib/live-tabs";
import { useSessionRecovery } from "../../lib/session-recovery";
import { activeCards } from "../../lib/sidebar-views";
import {
  type AgentState,
  type AttentionItem,
  type AttentionLevel,
  focusPane,
  jumpToAgent,
  showProject,
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

function timeAgo(ts: number, now: number): string {
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "";
  return timeAgo(startedAt * 1000, now);
}

// ─── Views ───────────────────────────────────────────────────────────────

function useNavigateToAgent() {
  const markRead = useAgentStore((s) => s.markAttentionRead);
  return useCallback(
    (agentId: string, projectId: string) => {
      markRead(agentId);
      jumpToAgent(agentId, projectId);
    },
    [markRead],
  );
}

/** The Agents view: one card per project with live sessions, in the user's order */
export function AgentsView() {
  const agents = useAgentStore((s) => s.agents);
  const activeOnly = useAppStore((s) => s.sidebarActiveOnly);
  // Every live agent, one waiting on you included: its row carries the amber mark, and the
  // attention list is a separate view, so nothing shows twice
  const activeAgents = Object.values(agents).filter((a) => ACTIVE_STATUSES.has(a.status));
  const attentionItems = useAgentStore((s) => s.attentionItems);
  // One card per project in the user's order, its live tabs inside; the card carries its Cmd+n.
  // A live session no pane shows joins its project's card
  const groups = useLiveTabGroups();
  const cards = useMemo(
    () => groupByProject(withPanelessSessions(groups, agents)),
    [groups, agents],
  );
  const shownCards = useMemo(
    () => (activeOnly ? activeCards(cards, agents, attentionItems) : cards),
    [activeOnly, cards, agents, attentionItems],
  );
  const agentsByProject = useMemo(
    () =>
      new Map(
        shownCards.map((c) => [
          c.projectId,
          Object.fromEntries(
            c.tabs
              .flatMap((t) => t.agentIds)
              .flatMap((id) => (agents[id] ? [[id, agents[id]]] : [])),
          ) as Record<string, AgentState>,
        ]),
      ),
    [shownCards, agents],
  );
  const projectShortcuts = useProjectShortcuts();
  const setOrder = useAppStore((s) => s.setLiveProjectOrder);
  const savedOrder = useAppStore((s) => s.liveProjectOrder);

  const navigateToAgent = useNavigateToAgent();

  // Reorder over every live card, hidden ones too, so "Active only" never moves a Cmd+n.
  // Dropped on the card below it goes after it (inserting before put it back where it was)
  const reorder = usePointerReorder((drag, target) =>
    setOrder(
      reorderProjectOrder(
        cards.map((c) => c.projectId),
        savedOrder,
        drag,
        target,
      ),
    ),
  );
  // The same rule reorderKeys applies: dropped on a card below lands after it, above lands before
  const dropSideFor = (key: string): "before" | "after" | null => {
    const { draggingKey, overKey } = reorder;
    if (!draggingKey || overKey !== key || draggingKey === key) return null;
    const keys = cards.map((c) => c.projectId);
    return keys.indexOf(draggingKey) < keys.indexOf(key) ? "after" : "before";
  };
  // The project on screen stands out, and blinks when a Cmd+n jump lands on it
  const activeProjectId = useAppStore((s) =>
    s.activeView === "workspace" ? s.activeProjectId : null,
  );
  const projectWorkspaces = useWorkspaceStore((s) => s.projectWorkspaces);
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
  const recovery = useSessionRecovery();
  const recovering = reconnectingLabel(recovery);

  if (shownCards.length === 0) {
    if (recovering) return <RecoveryNotice label={recovering} />;
    return (
      <p className="py-2 text-center text-[9px] italic text-text-muted">
        {activeOnly && activeAgents.length > 0
          ? "No agent is working or waiting on you"
          : "No agents active"}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {recovering && <RecoveryNotice label={recovering} />}
      {shownCards.map((card) => (
        <ProjectCard
          key={card.projectId}
          card={card}
          shortcut={shortcutLabel(projectShortcuts.get(card.projectId))}
          agents={agentsByProject.get(card.projectId) ?? {}}
          onNavigate={navigateToAgent}
          itemProps={reorder.itemProps}
          dragging={reorder.draggingKey === card.projectId}
          dropSide={dropSideFor(card.projectId)}
          onScreen={card.projectId === activeProjectId}
          activeTabId={projectWorkspaces[card.projectId]?.activeTabId ?? null}
          flashKey={flashKey}
        />
      ))}
    </div>
  );
}

/** The Needs attention view: unread first, then by level, newest first */
export function AttentionView() {
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
  const navigateToAgent = useNavigateToAgent();

  const attentionItems = useMemo(() => {
    const items = Object.values(rawItems);
    return items.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      const ld = ATTENTION_LEVEL_ORDER[a.level] - ATTENTION_LEVEL_ORDER[b.level];
      if (ld !== 0) return ld;
      return b.timestamp - a.timestamp;
    });
  }, [rawItems]);
  const hasRead = attentionItems.some((i) => i.read && !i.pinned);

  if (attentionItems.length === 0) {
    return <p className="py-2 text-center text-[9px] italic text-text-muted">Nothing needs you</p>;
  }

  return (
    <div className="space-y-1">
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
  );
}

/** Startup reattach in progress: sessions are listed, their terminals are on the way */
function RecoveryNotice({ label }: { label: string }) {
  return (
    <p className="flex items-center justify-center gap-1.5 py-1 text-[9px] text-text-muted">
      <Loader2 className="h-2.5 w-2.5 animate-spin text-accent" />
      {label}
    </p>
  );
}

// ─── Project Card ────────────────────────────────────────────────────────

interface ProjectCardProps {
  card: LiveProjectGroup;
  shortcut: string | null;
  /** This project's sessions only */
  agents: Record<string, AgentState>;
  onNavigate: (agentId: string, projectId: string) => void;
  /** Press anywhere on the card and move to reorder it (Cmd+2..9 number projects in this order) */
  itemProps: ReturnType<typeof usePointerReorder>["itemProps"];
  dragging: boolean;
  /** Where the dragged card lands: a line above this one (moving up) or below (moving down) */
  dropSide: "before" | "after" | null;
  /** The project is on screen */
  onScreen: boolean;
  /** The project's own active tab, marked when it has several live ones */
  activeTabId: string | null;
  /** The group key a Cmd+n jump landed on */
  flashKey: string | null;
}

// Groups rebuild on every agent push, so the card is compared by content and agents by entry
const sameCardProps = (a: ProjectCardProps, b: ProjectCardProps) =>
  (Object.keys(a) as (keyof ProjectCardProps)[]).every((k) =>
    k === "card"
      ? JSON.stringify(a.card) === JSON.stringify(b.card)
      : k === "agents"
        ? shallow(a.agents, b.agents)
        : Object.is(a[k], b[k]),
  );

const ProjectCard = memo(function ProjectCard({
  card,
  shortcut,
  agents,
  onNavigate,
  itemProps,
  dragging,
  dropSide,
  onScreen,
  activeTabId,
  flashKey,
}: ProjectCardProps) {
  const { data: project } = useProject(card.projectId);
  const single = card.tabs.length === 1;
  const flashing = single && card.tabs.some((t) => t.key === flashKey);
  const rowsOf = (tab: LiveTabGroup) =>
    tab.agentIds
      .map((id) => agents[id])
      .filter((a): a is AgentState => !!a)
      .map((agent) => (
        <RunningAgentRow
          key={agent.id}
          agent={agent}
          onClick={() => onNavigate(agent.id, agent.projectId)}
        />
      ));
  return (
    <div
      {...itemProps(card.projectId)}
      className={cn(
        "relative select-none rounded-lg border bg-bg-tertiary/30 p-1.5 transition-colors",
        onScreen ? "border-accent/60" : "border-border/50",
        flashing && "animate-flash-once",
        dragging && "opacity-50",
        dropSide && "border-accent/60",
      )}
    >
      {dropSide && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent",
            dropSide === "before" ? "-top-1" : "-bottom-1",
          )}
        />
      )}
      <button
        type="button"
        onClick={() => showProject(card.projectId)}
        className="mb-1 flex w-full min-w-0 cursor-grab items-center gap-1.5 px-0.5 text-left active:cursor-grabbing"
        title="Go to this project; drag to reorder"
      >
        {project ? (
          <ProjectAvatar project={project} className="h-3 w-3" />
        ) : (
          <Cuboid className="h-3 w-3 shrink-0 text-accent/70" />
        )}
        <span className="min-w-0 truncate text-[10px] font-medium text-text-secondary">
          {project?.name ?? card.projectId.slice(0, 12)}
        </span>
        {shortcut && (
          <kbd className="ml-auto shrink-0 rounded border border-border px-1 font-mono text-[9px] text-text-muted">
            {shortcut}
          </kbd>
        )}
      </button>
      {single ? (
        <div className="space-y-0.5">{card.tabs[0] && rowsOf(card.tabs[0])}</div>
      ) : (
        <div className="space-y-1">
          {card.tabs.map((tab) => {
            const active = tab.tabId === activeTabId;
            return (
              <div key={tab.key}>
                {tab.tabId === PANELESS_TAB ? (
                  <span className="block px-1 pl-2 text-[9px] text-text-muted">{tab.tabLabel}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => focusPane(card.projectId, tab.tabId)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[9px] transition-colors hover:bg-white/5",
                      active ? "text-text-secondary" : "text-text-muted",
                      tab.key === flashKey && "animate-flash-once",
                    )}
                    title="Go to this tab"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1 w-1 shrink-0 rounded-full",
                        active ? "bg-accent" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 truncate">{tab.tabLabel}</span>
                  </button>
                )}
                <div className="space-y-0.5 pl-1">{rowsOf(tab)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}, sameCardProps);

// ─── Running Agent Row ───────────────────────────────────────────────────

function RunningAgentRow({ agent, onClick }: { agent: AgentState; onClick: () => void }) {
  // waiting_input is just a turn boundary (T123) — the amber warning only
  // belongs to agents with a live UNREAD attention item (verify round 3:
  // the row kept its ⚠ after the user answered the prompt).
  const hasUnreadAttention = useAgentStore((s) => s.isUnread(agent.id));
  const isWaiting = agent.status === "waiting_input" && hasUnreadAttention;
  const recovery = useSessionRecovery();
  const reconnecting = isSessionReconnecting(recovery, agent.id);
  const now = useNow();

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] transition-colors",
        "cursor-pointer hover:bg-white/5",
        isWaiting && "bg-amber-500/5",
      )}
      onClick={onClick}
      title={reconnecting ? "Reconnecting to its terminal" : agent.taskDescription}
    >
      {/* Reconnecting / attention warning / idle dot / busy spinner */}
      {reconnecting ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text-muted" />
      ) : isWaiting ? (
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
        {reconnecting ? "Reconnecting..." : (agent.currentStep ?? agent.taskDescription)}
      </span>

      {/* Elapsed time */}
      <span className="shrink-0 text-[9px] text-text-muted">{elapsed(agent.startedAt, now)}</span>
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
  const now = useNow();

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg border transition-colors",
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

        {/* Row 1: who, what it waits for, since when. Row 2: its project (a wide chip beside
            the name pushed the card past the sidebar) */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[10px] font-medium text-text-primary">{name}</span>
            {item.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
            {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <span className="ml-auto flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
              <LevelIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{item.reason}</span>
              <span className="shrink-0">{timeAgo(item.timestamp, now)}</span>
            </span>
          </div>
          {project && (
            <ProjectChip project={project} className="mt-0.5 w-fit max-w-full py-0 text-[9px]" />
          )}
        </div>
      </button>

      {/* Actions (hover) */}
      {/* Over the card on hover: hidden, they no longer take the text's width */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-bg-secondary/95 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
