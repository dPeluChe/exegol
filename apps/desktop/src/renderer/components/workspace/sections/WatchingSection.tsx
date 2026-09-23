import { LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ArrowUpRight, ChevronDown, ChevronRight, PinOff } from "lucide-react";
import { useMemo } from "react";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { MAX_OPEN_MIRRORS, useWatchStore } from "../../../stores/watch";
import { AgentIcon } from "../../common/AgentIcon";
import { FilterChip } from "../../common/FilterChip";
import { ProjectChip, type ProjectMeta } from "../../common/ProjectChip";
import { SessionAlias } from "../../common/SessionAlias";
import { StatusDot } from "../../common/StatusDot";
import { TerminalInstance } from "../../terminal/TerminalInstance";

/**
 * T194: sessions pinned from any project, each with an interactive mirror of its
 * terminal. The mirror types into the session but the pane that owns it keeps
 * the PTY size, so watching from here never reflows or breaks the session.
 */
export function WatchingSection({
  projectMeta,
  onOpenAgent,
}: {
  projectMeta: Map<string, ProjectMeta>;
  onOpenAgent: (agent: AgentState) => void;
}) {
  const watched = useWatchStore((s) => s.watched);
  const opened = useWatchStore((s) => s.open);
  const columns = useWatchStore((s) => s.columns);
  const setColumns = useWatchStore((s) => s.setColumns);
  const agents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);

  // Needs input first, then working, then idle, then ended; pin order within each
  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const a = agents[id];
      const item = attentionItems[id];
      if (!a) return 4;
      if (item && !item.read) return 0;
      if (a.status === "running" || a.status === "spawning") return 1;
      return LIVE_STATUSES.has(a.status) ? 2 : 3;
    };
    return watched.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => a.r - b.r || a.i - b.i);
  }, [watched, agents, attentionItems]);

  // Questions open a mirror on their own, but the WebGL cap holds for them too
  const openIds = useMemo(() => {
    const ids = ordered.filter(({ id, r }) => r === 0 || opened.includes(id)).map((o) => o.id);
    return new Set(ids.slice(0, MAX_OPEN_MIRRORS));
  }, [ordered, opened]);

  if (watched.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Watching
        <span className="font-normal">({watched.length})</span>
        <span className="font-normal normal-case tracking-normal text-text-muted/60">
          up to {MAX_OPEN_MIRRORS} open
        </span>
        <div className="ml-auto flex items-center gap-1 font-normal normal-case tracking-normal">
          <FilterChip active={columns === 1} onClick={() => setColumns(1)}>
            1 column
          </FilterChip>
          <FilterChip active={columns === 2} onClick={() => setColumns(2)}>
            2 columns
          </FilterChip>
        </div>
      </h3>
      <div className={cn("grid grid-cols-1 gap-2", columns === 2 && "xl:grid-cols-2")}>
        {ordered.map(({ id, r }) => (
          <WatchCard
            key={id}
            agentId={id}
            agent={agents[id]}
            needsInput={r === 0}
            isOpen={openIds.has(id)}
            project={agents[id] ? projectMeta.get(agents[id].projectId) : undefined}
            onOpenAgent={onOpenAgent}
          />
        ))}
      </div>
    </section>
  );
}

function WatchCard({
  agentId,
  agent,
  needsInput,
  isOpen,
  project,
  onOpenAgent,
}: {
  agentId: string;
  agent: AgentState | undefined;
  needsInput: boolean;
  isOpen: boolean;
  project: ProjectMeta | undefined;
  onOpenAgent: (agent: AgentState) => void;
}) {
  const openedByUser = useWatchStore((s) => s.open.includes(agentId));
  const toggleOpen = useWatchStore((s) => s.toggleOpen);
  const toggleWatch = useWatchStore((s) => s.toggleWatch);

  if (!agent) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-text-muted">
        Session no longer available
        <button
          type="button"
          onClick={() => toggleWatch(agentId)}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-text-primary"
        >
          <PinOff className="h-3 w-3" />
          Unwatch
        </button>
      </div>
    );
  }

  const live = LIVE_STATUSES.has(agent.status);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-bg-secondary/40",
        needsInput ? "border-amber-500/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() =>
            // Opened by a question, not by you: collapsing means "seen"
            isOpen && !openedByUser
              ? useAgentStore.getState().markAttentionRead(agentId)
              : toggleOpen(agentId)
          }
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title={isOpen ? "Collapse" : "Open the terminal here"}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusDot status={agent.status} activityLevel={agent.activityLevel} size="sm" />
          <AgentIcon provider={agent.cliType} size={16} />
          <span className="min-w-0 shrink truncate">
            <SessionAlias agent={agent} textClassName="text-xs" />
          </span>
          {project && <ProjectChip project={project} className="text-[10px]" />}
          {needsInput && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              Needs input
            </span>
          )}
          {!isOpen && agent.currentStep && (
            <span className="min-w-0 truncate text-[10px] italic text-text-muted/70">
              {agent.currentStep}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenAgent(agent)}
          className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Go to its project and pane"
        >
          <ArrowUpRight className="h-3 w-3" />
          Open
        </button>
        <button
          type="button"
          onClick={() => toggleWatch(agentId)}
          className="shrink-0 rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Stop watching"
        >
          <PinOff className="h-3 w-3" />
        </button>
      </div>

      {isOpen &&
        (live ? (
          // Focusing the mirror keeps it open after the question is answered and
          // clears the attention badge, as reading it in its pane would.
          <div
            className="mx-2 mb-2 overflow-hidden rounded-md border border-border bg-black/40 p-1"
            onFocusCapture={() => {
              if (!openedByUser) toggleOpen(agentId);
              if (needsInput) useAgentStore.getState().markAttentionRead(agentId);
            }}
          >
            <TerminalInstance
              key={`mirror-${agentId}`}
              agentId={agentId}
              cliType={agent.cliType}
              mirror
            />
          </div>
        ) : (
          <p className="mx-3 mb-2 text-[11px] text-text-muted">
            Session ended ({agent.status}). Open it to read the transcript or resume.
          </p>
        ))}
    </div>
  );
}
