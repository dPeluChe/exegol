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
import { useCallback, useEffect, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import {
  type AgentState,
  type AttentionItem,
  type AttentionLevel,
  useAgentStore,
} from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { collectPaneIds, selectPanes, selectTabs, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

// ─── Level config ────────────────────────────────────────────────────────

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

// ─── Animated agent spinners — each agent gets a unique "pet" animation ──

interface SpinnerPreset {
  frames: string[];
  interval: number;
  color: string;
}

const SPINNER_PRESETS: SpinnerPreset[] = [
  // Braille wave
  { frames: ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"], interval: 80, color: "text-accent" },
  // Braille dots orbit
  {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
    color: "text-purple-400",
  },
  // Moon phases
  { frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"], interval: 150, color: "" },
  // Bouncing ball
  { frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"], interval: 100, color: "text-green-400" },
  // Growing bar
  {
    frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "▉", "▊", "▋", "▌", "▍", "▎", "▏"],
    interval: 60,
    color: "text-cyan-400",
  },
  // Arrows dance
  { frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"], interval: 100, color: "text-amber-400" },
  // DNA helix
  { frames: ["╫", "╪", "╫", "╬", "╪", "╫"], interval: 120, color: "text-pink-400" },
  // Heartbeat
  { frames: ["♡", "♥", "♡", "♡"], interval: 200, color: "text-red-400" },
  // Stars twinkle
  { frames: ["✦", "✧", "✦", "⊹", "✧", "⊹"], interval: 180, color: "text-yellow-400" },
  // Blocks build
  { frames: ["░", "▒", "▓", "█", "▓", "▒", "░"], interval: 100, color: "text-blue-400" },
];

/** Deterministic spinner selection based on agent ID — same agent always gets the same animation */
function getSpinnerIndex(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SPINNER_PRESETS.length;
}

function AgentSpinner({ agentId, className }: { agentId: string; className?: string }) {
  const preset = SPINNER_PRESETS[getSpinnerIndex(agentId)] ?? SPINNER_PRESETS[0];
  const frames = preset?.frames ?? ["⣾"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), preset?.interval ?? 80);
    return () => clearInterval(id);
  }, [frames.length, preset?.interval]);
  return (
    <span className={cn("inline-block w-4 text-center font-mono", preset?.color, className)}>
      {frames[frame]}
    </span>
  );
}

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
  const attentionItems = useAgentStore((s) => s.getSortedAttention());
  const dismiss = useAgentStore((s) => s.dismissAttention);
  const togglePin = useAgentStore((s) => s.toggleAttentionPin);
  const clearRead = useAgentStore((s) => s.clearReadAttention);
  const markRead = useAgentStore((s) => s.markAttentionRead);

  // Force re-render every 10s for elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // Group active agents by project
  const activeAgents = Object.values(agents).filter((a) => ACTIVE_STATUSES.has(a.status));
  const byProject = new Map<string, AgentState[]>();
  for (const agent of activeAgents) {
    const list = byProject.get(agent.projectId) ?? [];
    list.push(agent);
    byProject.set(agent.projectId, list);
  }

  const navigateToAgent = useCallback(
    (agentId: string, projectId: string) => {
      markRead(agentId);
      useAgentStore.getState().markRead(agentId);
      useAgentStore.getState().markAttentionRead(agentId);

      const app = useAppStore.getState();
      if (app.activeProjectId !== projectId) {
        app.setActiveProject(projectId);
      }

      const ws = useWorkspaceStore.getState();
      const tabs = selectTabs(ws);
      const panes = selectPanes(ws);
      for (const tab of tabs) {
        for (const paneId of collectPaneIds(tab.layout)) {
          const pane = panes[paneId];
          if (pane?.type === "terminal" && pane.agentId === agentId) {
            ws.setActiveTab(tab.id);
            ws.setFocusedPane(paneId);
            useAgentStore.getState().setFocusedAgent(agentId);
            return;
          }
        }
      }
    },
    [markRead],
  );

  const hasRunning = byProject.size > 0;
  const hasAttention = attentionItems.length > 0;
  const hasRead = attentionItems.some((i) => i.read && !i.pinned);

  if (!hasRunning && !hasAttention) {
    return <p className="py-2 text-center text-[9px] italic text-text-muted">No agents active</p>;
  }

  return (
    <div className="space-y-2">
      {/* Running agents grouped by project */}
      {hasRunning && (
        <div className="space-y-1.5">
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

      {/* Attention items — agents that finished and need review */}
      {hasAttention && (
        <div className="space-y-1">
          {hasRunning && (
            <div className="flex items-center gap-2 px-0.5 pt-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Needs Attention
              </span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
          )}
          {attentionItems.map((item) => (
            <AttentionCard
              key={item.agentId}
              item={item}
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
  const isWaiting = agent.status === "waiting_input";

  return (
    // biome-ignore lint/a11y/useSemanticElements: nested structure prevents button usage
    <div
      className={cn(
        "flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] transition-colors",
        "cursor-pointer hover:bg-white/5",
        isWaiting && "bg-amber-500/5",
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      role="button"
      tabIndex={0}
      title={agent.taskDescription}
    >
      {/* Animated spinner (unique per agent) or waiting indicator */}
      {isWaiting ? (
        <AlertTriangle className="h-3 w-3 shrink-0 animate-pulse text-amber-400" />
      ) : (
        <AgentSpinner agentId={agent.id} />
      )}

      {/* Provider icon */}
      <AgentIcon provider={agent.cliType} size={14} />

      {/* Agent info */}
      <span className="font-medium text-text-primary">{agent.cliType}</span>
      <span className="min-w-0 flex-1 truncate text-text-muted">
        {agent.currentStep ?? agent.taskDescription}
      </span>

      {/* Elapsed time */}
      <span className="shrink-0 text-[9px] text-text-muted">{elapsed(agent.startedAt)}</span>
    </div>
  );
}

// ─── Attention Card ──────────────────────────────────────────────────────

function AttentionCard({
  item,
  onNavigate,
  onDismiss,
  onTogglePin,
}: {
  item: AttentionItem;
  onNavigate: () => void;
  onDismiss: () => void;
  onTogglePin: () => void;
}) {
  const config = LEVEL_CONFIG[item.level];
  const LevelIcon = config.icon;

  return (
    // biome-ignore lint/a11y/useSemanticElements: can't use <button> — contains nested <button> children for pin/dismiss
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
        item.read ? "border-border/50 opacity-60" : config.bgClass,
        "cursor-pointer hover:opacity-100",
      )}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === "Enter") onNavigate();
      }}
      role="button"
      tabIndex={0}
    >
      {/* Level dot */}
      <div className={cn("h-2 w-2 shrink-0 rounded-full", config.dotClass)} />

      {/* Provider icon */}
      <AgentIcon provider={item.cliType} size={14} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-text-primary">{item.cliType}</span>
          {item.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
          {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
          <LevelIcon className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{item.reason}</span>
          <span className="shrink-0">{timeAgo(item.timestamp)}</span>
        </div>
      </div>

      {/* Actions (hover) */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {!item.read && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              useAgentStore.getState().markAttentionRead(item.agentId);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Mark as read"
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
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
