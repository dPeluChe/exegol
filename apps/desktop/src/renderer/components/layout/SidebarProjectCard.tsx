import { isSessionReconnecting } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AlertTriangle, Cuboid, Loader2 } from "lucide-react";
import { memo } from "react";
import { shallow } from "zustand/shallow";
import { useNow } from "../../hooks/use-now";
import type { usePointerReorder } from "../../hooks/use-pointer-reorder";
import { useProject } from "../../hooks/use-trpc";
import { type LiveProjectGroup, type LiveTabGroup, PANELESS_TAB } from "../../lib/live-tabs";
import { useSessionRecovery } from "../../lib/session-recovery";
import { type AgentState, focusPane, showProject, useAgentStore } from "../../stores/agents";
import { AgentIcon } from "../common/AgentIcon";
import { AgentSpinner } from "../common/AgentSpinner";
import { ProjectAvatar } from "../common/ProjectAvatar";
import { ProjectSignals } from "./ProjectSignals";
import { elapsed } from "./sidebar-time";

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

export const ProjectCard = memo(function ProjectCard({
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
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <ProjectSignals projectId={card.projectId} />
          {shortcut && (
            <kbd className="shrink-0 rounded border border-border px-1 font-mono text-[9px] text-text-muted">
              {shortcut}
            </kbd>
          )}
        </span>
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
  const unread = useAgentStore((s) => agent.id in s.unseenTurns);
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
          className={cn(
            "mx-0.5 inline-block h-2 w-2 shrink-0 rounded-full",
            unread ? "bg-accent" : "bg-zinc-500",
          )}
          aria-hidden="true"
          title={unread ? "Finished: not seen yet" : "Idle — waiting for your next prompt"}
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
