import { LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  MessagesSquare,
  Send,
  Square,
  XCircle,
} from "lucide-react";
import { memo, useState } from "react";
import { useNow } from "../../../hooks/use-now";
import { submitToAgent } from "../../../lib/agent-input";
import { type AgentState, isWorking } from "../../../stores/agents";
import { ResumeButton } from "../../agents/ResumeButton";
import { AccessModeBadge } from "../../common/AccessModeBadge";
import { AgentIcon } from "../../common/AgentIcon";
import { AgentSpinner } from "../../common/AgentSpinner";
import { McpStatusIndicator } from "../../common/McpStatusIndicator";
import { ProjectChip, type ProjectMeta } from "../../common/ProjectChip";
import { QuietBadge } from "../../common/QuietControls";
import { SessionAlias } from "../../common/SessionAlias";
import { WatchToggle } from "../../common/WatchToggle";
import { TerminalInstance } from "../../terminal/TerminalInstance";
import { AgentMessagesPanel, useAgentMessages } from "./AgentMessages";
import { FleetCardMenu } from "./DashboardMenus";

const STATUS_CONFIG: Record<
  string,
  { icon: typeof Cpu; color: string; bg: string; label: string }
> = {
  running: {
    icon: Cpu,
    color: "text-green-400",
    bg: "border-green-500/30 bg-green-500/5",
    label: "Running",
  },
  spawning: {
    icon: Clock,
    color: "text-blue-400",
    bg: "border-blue-400/30 bg-blue-400/5",
    label: "Starting",
  },
  waiting_input: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "border-amber-500/30 bg-amber-500/5",
    label: "Waiting",
  },
  completed: {
    icon: CheckCircle,
    color: "text-text-muted",
    bg: "border-border",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-red-400",
    bg: "border-red-500/30 bg-red-500/5",
    label: "Failed",
  },
  crashed: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "border-red-500/30 bg-red-500/5",
    label: "Crashed",
  },
  stopped: { icon: Square, color: "text-text-muted", bg: "border-border", label: "Stopped" },
};

const DEFAULT_STATUS = {
  icon: Cpu,
  color: "text-text-muted",
  bg: "border-border",
  label: "Unknown",
};

function elapsedStr(startedAt: number, now: number): string {
  const s = Math.floor(now / 1000 - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Leaf timer: only this span re-renders as time passes, not the whole grid. */
function Elapsed({ startedAt }: { startedAt: number }) {
  const now = useNow();
  return (
    <span className="flex items-center gap-0.5">
      <Clock className="h-2.5 w-2.5" />
      {elapsedStr(startedAt, now)}
    </span>
  );
}

// Memo: the dashboard regroups on every push; a card re-renders only when its own agent changes
export const AgentCard = memo(function AgentCard({
  agent,
  projectMeta,
  hasUnread,
  onOpenAgent,
  onArchiveAgent,
}: {
  agent: AgentState;
  /** Set only in by-state grouping — shows which project the card belongs to. */
  projectMeta?: ProjectMeta;
  hasUnread: boolean;
  onOpenAgent: (agent: AgentState) => void;
  /** Set only for ended sessions — a live agent has nothing to dismiss. */
  onArchiveAgent?: (agentId: string) => void;
}) {
  const onClick = () => onOpenAgent(agent);
  const onArchive = onArchiveAgent ? () => onArchiveAgent(agent.id) : undefined;
  const config = STATUS_CONFIG[agent.status] ?? DEFAULT_STATUS;
  const canPeek = LIVE_STATUSES.has(agent.status);
  const [peekOpen, setPeekOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const { data: messages = [] } = useAgentMessages(agent.id);

  return (
    <FleetCardMenu agent={agent} onOpen={onClick} onArchive={onArchive}>
      <div
        className={cn(
          "group relative flex flex-col rounded-xl border p-3 transition-all",
          // Ended sessions stay quiet: a wall of red cards drowned the live ones (the icon keeps the state)
          canPeek ? config.bg : "border-border bg-bg-secondary/40",
          "cursor-pointer hover:shadow-lg hover:shadow-black/10",
        )}
      >
        {/* Covers the card so a click anywhere opens it; the card's own controls sit above it as siblings */}
        <button
          type="button"
          onClick={onClick}
          aria-label={`Open ${agent.alias ?? agent.cliType}`}
          className="absolute inset-0 rounded-xl"
        />
        {/* Clicks fall through to the button; controls and titled badges (tooltips) still take the pointer.
          The alias pencil shows on card hover because its own hover target is now pass-through. */}
        <div className="pointer-events-none relative flex items-start gap-3 group-hover:[&_.group\/alias_button]:inline-block [&_[title]]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto">
          {/* Left: icon + spinner */}
          <div className="flex flex-col items-center gap-1.5 pt-0.5">
            <AgentIcon provider={agent.cliType} size={28} />
            {!hasUnread && isWorking(agent) && (
              <AgentSpinner agentId={agent.id} className="text-accent" />
            )}
          </div>

          {/* Center: info */}
          <div className="min-w-0 flex-1">
            <AgentCardTitle agent={agent} projectMeta={projectMeta} hasUnread={hasUnread} />
            <p className="mt-0.5 truncate text-xs text-text-muted">{agent.taskDescription}</p>
            {agent.currentStep && (
              <p className="mt-0.5 truncate text-[10px] text-text-muted/70 italic">
                {agent.currentStep}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
              {agent.startedAt && <Elapsed startedAt={agent.startedAt} />}
              <AgentTokenUsage usage={agent.tokenUsage} />
              <AccessModeBadge mode={agent.accessMode} variant="inline" />
              <McpStatusIndicator agentId={agent.id} accessMode={agent.accessMode} />
              {agent.branchName && (
                <span className="truncate rounded bg-white/5 px-1 py-0.5 font-mono text-[9px]">
                  {agent.branchName}
                </span>
              )}
              {messages.length > 0 && (
                <MessagesToggle
                  count={messages.length}
                  open={messagesOpen}
                  onToggle={() => setMessagesOpen((v) => !v)}
                />
              )}
              {canPeek && (
                <PeekControls
                  agentId={agent.id}
                  peekOpen={peekOpen}
                  onTogglePeek={() => setPeekOpen((v) => !v)}
                />
              )}
              {onArchive && <EndedSessionActions agent={agent} onArchive={onArchive} />}
            </div>
          </div>
        </div>

        {peekOpen && <PeekPanel agent={agent} />}
        {messagesOpen && messages.length > 0 && (
          <AgentMessagesPanel agentId={agent.id} messages={messages} />
        )}
      </div>
    </FleetCardMenu>
  );
});

/** What this agent said to the others and they to it (agent_send), with delivery state */
function MessagesToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-white/10 hover:text-text-primary",
        open ? "text-accent" : "text-text-muted",
      )}
      title="Messages between this agent and the others"
    >
      <MessagesSquare className="h-3 w-3" />
      {count}
    </button>
  );
}

function AgentCardTitle({
  agent,
  projectMeta,
  hasUnread,
}: {
  agent: AgentState;
  projectMeta?: ProjectMeta;
  hasUnread: boolean;
}) {
  const config = STATUS_CONFIG[agent.status] ?? DEFAULT_STATUS;
  const StatusIcon = config.icon;
  return (
    <div className="flex items-center gap-2">
      <SessionAlias agent={agent} />
      <QuietBadge agent={agent} />
      {agent.alias && <span className="shrink-0 text-[10px] text-text-muted">{agent.cliType}</span>}
      <span className={cn("flex items-center gap-1 text-[10px]", config.color)}>
        <StatusIcon className="h-3 w-3" />
        {agent.suspended ? "Suspended" : hasUnread ? "Needs input" : config.label}
      </span>
      {projectMeta && <ProjectChip project={projectMeta} className="ml-auto text-[9px]" />}
    </div>
  );
}

function AgentTokenUsage({ usage }: { usage: AgentState["tokenUsage"] }) {
  if (!(usage.input > 0 || usage.output > 0)) return null;
  return (
    <span className="flex items-center gap-0.5">
      <Coins className="h-2.5 w-2.5" />
      {((usage.input + usage.output) / 1000).toFixed(1)}k
      {usage.cost > 0 && (
        <span className="ml-0.5 text-text-muted/60">${usage.cost.toFixed(3)}</span>
      )}
    </span>
  );
}

function PeekControls({
  agentId,
  peekOpen,
  onTogglePeek,
}: {
  agentId: string;
  peekOpen: boolean;
  onTogglePeek: () => void;
}) {
  return (
    <>
      <WatchToggle agentId={agentId} className="text-[10px]" />
      <button
        type="button"
        onClick={onTogglePeek}
        className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Peek at the terminal and reply inline"
      >
        {peekOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Peek
      </button>
    </>
  );
}

function EndedSessionActions({ agent, onArchive }: { agent: AgentState; onArchive: () => void }) {
  return (
    <>
      <ResumeButton agent={agent} className="ml-auto" />
      <button
        type="button"
        onClick={onArchive}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-text-primary group-hover:opacity-100"
        title="Archive — keeps the session, removes the card"
      >
        <Archive className="h-3 w-3" />
      </button>
    </>
  );
}

/** T156 peek-and-reply: live read-only terminal + one-line reply to the PTY.
 *  liveFeed streams real output (colors, TUIs) without stdin or PTY resize —
 *  the pane in the Agents tab keeps sole ownership of the terminal size. */
function PeekPanel({ agent }: { agent: AgentState }) {
  const [reply, setReply] = useState("");

  const send = () => {
    const text = reply.trim();
    if (!text) return;
    submitToAgent(agent.id, text);
    setReply("");
  };

  return (
    <div className="relative mt-2 border-t border-border pt-2">
      <div className="h-52 overflow-hidden rounded-md border border-border bg-black/40 p-1">
        <TerminalInstance
          key={`peek-${agent.id}`}
          agentId={agent.id}
          cliType={agent.cliType}
          readOnly
          liveFeed
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Reply without leaving the dashboard…"
          aria-label="Reply to agent"
          className="h-7 flex-1 rounded-md border border-border bg-bg-primary px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!reply.trim()}
          aria-label="Send reply"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-white/5 hover:text-text-primary disabled:opacity-40"
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
