import { LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ArrowUpRight, ChevronDown, GripVertical, PinOff, X } from "lucide-react";
import { type DragEvent, useMemo, useState } from "react";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { MAX_OPEN_MIRRORS, useWatchStore } from "../../../stores/watch";
import { AgentIcon } from "../../common/AgentIcon";
import { FilterChip } from "../../common/FilterChip";
import { ProjectChip, type ProjectMeta } from "../../common/ProjectChip";
import { SessionAlias } from "../../common/SessionAlias";
import { StatusDot } from "../../common/StatusDot";
import { TerminalInstance } from "../../terminal/TerminalInstance";

const DRAG_TYPE = "application/x-exegol-watch";

interface DragProps {
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * T194: sessions pinned from any project, each with an interactive mirror of its
 * terminal. The mirror types into the session but the pane that owns it keeps
 * the PTY size, so watching from here never reflows or breaks the session.
 *
 * Open sessions get full-height cards, `columns` per row; a collapsed one stays
 * in its row as a thin vertical strip. Order is the user's (drag strips or card
 * headers); a session that needs input opens itself in place.
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
  const moveWatched = useWatchStore((s) => s.moveWatched);
  const agents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // A question opens a mirror on its own, but the open cap holds for it too
  const openIds = useMemo(() => {
    const asks = (id: string) => !!attentionItems[id] && !attentionItems[id]?.read;
    const ids = watched.filter((id) => agents[id] && (opened.includes(id) || asks(id)));
    return new Set(ids.slice(0, MAX_OPEN_MIRRORS));
  }, [watched, opened, attentionItems, agents]);

  if (watched.length === 0) return null;

  const needsInput = (id: string) => !!attentionItems[id] && !attentionItems[id]?.read;
  // Rows follow the user's order: each holds up to `columns` open cards, and a
  // collapsed session stays in its row as a thin strip beside them
  const rows: string[][] = [];
  let row: string[] = [];
  let openInRow = 0;
  for (const id of watched) {
    if (openIds.has(id)) {
      if (openInRow === columns) {
        rows.push(row);
        row = [];
        openInRow = 0;
      }
      openInRow++;
    }
    row.push(id);
  }
  if (row.length) rows.push(row);

  const dragProps = (id: string): DragProps => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDragOver(id);
    },
    onDragLeave: () => setDragOver((cur) => (cur === id ? null : cur)),
    onDrop: (e) => {
      const moved = e.dataTransfer.getData(DRAG_TYPE);
      setDragOver(null);
      if (moved) moveWatched(moved, id);
    },
  });

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Watching
        <span className="font-normal">({watched.length})</span>
        <span className="font-normal normal-case tracking-normal text-text-muted/60">
          up to {MAX_OPEN_MIRRORS} open · drag to reorder
        </span>
        <div className="ml-auto flex items-center gap-1 font-normal normal-case tracking-normal">
          {([1, 2, 3] as const).map((n) => (
            <FilterChip key={n} active={columns === n} onClick={() => setColumns(n)}>
              {n === 1 ? "1 column" : `${n} side by side`}
            </FilterChip>
          ))}
        </div>
      </h3>

      {/* One container for every session, rows split by break elements: a
          session moving between rows keeps its identity, so opening or
          collapsing one never remounts (and repaints) the mirrors around it */}
      <div className="flex flex-wrap gap-x-2">
        {rows.flatMap((ids, rowIndex) => {
          const height = ids.some((id) => openIds.has(id))
            ? "max(320px, calc(100vh - 11rem))"
            : "10rem";
          const items = ids.map((id) => {
            const agent = agents[id];
            const common = {
              height,
              needsInput: needsInput(id),
              project: agent ? projectMeta.get(agent.projectId) : undefined,
              dropTarget: dragOver === id,
              dragProps: dragProps(id),
            };
            return openIds.has(id) && agent ? (
              <WatchCard key={id} agent={agent} onOpenAgent={onOpenAgent} {...common} />
            ) : (
              <CollapsedStrip key={id} agentId={id} agent={agent} {...common} />
            );
          });
          return rowIndex === 0
            ? items
            : [<div key={`break-${ids[0]}`} className="h-2 basis-full" />, ...items];
        })}
      </div>
    </section>
  );
}

function CollapsedStrip({
  agentId,
  agent,
  height,
  needsInput,
  project,
  dropTarget,
  dragProps,
}: {
  agentId: string;
  agent: AgentState | undefined;
  height: string;
  needsInput: boolean;
  project: ProjectMeta | undefined;
  dropTarget: boolean;
  dragProps: DragProps;
}) {
  const toggleOpen = useWatchStore((s) => s.toggleOpen);
  const toggleWatch = useWatchStore((s) => s.toggleWatch);
  const name = agent ? (agent.alias ?? agent.cliType) : "session gone";

  return (
    <div
      {...dragProps}
      style={{ height }}
      className={cn(
        "group flex w-9 shrink-0 cursor-grab flex-col items-center gap-2 rounded-xl border bg-bg-secondary/60 py-2 active:cursor-grabbing",
        needsInput ? "border-amber-500/50" : "border-border",
        dropTarget && "ring-1 ring-accent",
      )}
    >
      <button
        type="button"
        onClick={() => toggleWatch(agentId)}
        className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-text-primary group-hover:opacity-100"
        title="Stop watching"
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        disabled={!agent}
        onClick={() => toggleOpen(agentId)}
        className="flex min-h-0 flex-1 flex-col items-center gap-2 text-text-secondary hover:text-text-primary disabled:opacity-50"
        title={agent ? `Open ${name} here` : undefined}
      >
        {agent && <StatusDot status={agent.status} activityLevel={agent.activityLevel} size="sm" />}
        {agent && <AgentIcon provider={agent.cliType} size={16} />}
        {needsInput && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        <span
          className="min-h-0 truncate text-[11px] font-medium"
          style={{ writingMode: "vertical-rl" }}
        >
          {name}
          {project && <span className="font-normal text-text-muted"> · {project.name}</span>}
        </span>
      </button>
    </div>
  );
}

function WatchCard({
  agent,
  height,
  needsInput,
  project,
  onOpenAgent,
  dropTarget,
  dragProps,
}: {
  agent: AgentState;
  height: string;
  needsInput: boolean;
  project: ProjectMeta | undefined;
  onOpenAgent: (agent: AgentState) => void;
  dropTarget: boolean;
  dragProps: DragProps;
}) {
  const openedByUser = useWatchStore((s) => s.open.includes(agent.id));
  const toggleOpen = useWatchStore((s) => s.toggleOpen);
  const toggleWatch = useWatchStore((s) => s.toggleWatch);
  const live = LIVE_STATUSES.has(agent.status);

  return (
    <div
      // Full dashboard height: more rows scroll the dashboard itself
      style={{ height }}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-xl border bg-bg-secondary/40",
        needsInput ? "border-amber-500/40" : "border-border",
        dropTarget && "ring-1 ring-accent",
      )}
    >
      <div
        {...dragProps}
        className="flex cursor-grab items-center gap-2 px-2 py-2 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted/50" />
        <button
          type="button"
          onClick={() =>
            // Opened by a question, not by you: collapsing means "seen"
            openedByUser
              ? toggleOpen(agent.id)
              : useAgentStore.getState().markAttentionRead(agent.id)
          }
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Collapse to a strip"
        >
          <ChevronDown className="h-3.5 w-3.5" />
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
          onClick={() => toggleWatch(agent.id)}
          className="shrink-0 rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Stop watching"
        >
          <PinOff className="h-3 w-3" />
        </button>
      </div>

      {live ? (
        // Focusing the mirror keeps it open after the question is answered and
        // clears the attention badge, as reading it in its pane would.
        <div
          className="mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-black/40 p-1"
          onFocusCapture={() => {
            if (!openedByUser) toggleOpen(agent.id);
            if (needsInput) useAgentStore.getState().markAttentionRead(agent.id);
          }}
        >
          <TerminalInstance
            key={`mirror-${agent.id}`}
            agentId={agent.id}
            cliType={agent.cliType}
            mirror
          />
        </div>
      ) : (
        <p className="mx-3 mb-2 text-[11px] text-text-muted">
          Session ended ({agent.status}). Open it to read the transcript or resume.
        </p>
      )}
    </div>
  );
}
