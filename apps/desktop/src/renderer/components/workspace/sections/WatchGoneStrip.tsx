import type { Agent, AgentCliType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ArrowUpRight, ChevronDown, GripVertical, PinOff, Play } from "lucide-react";
import { useState } from "react";
import { fetchResumableCliTypes, resumeSessionInto } from "../../../hooks/use-resume-agent";
import { formatTimeAgoLong } from "../../../lib/format";
import { trpcMutate } from "../../../lib/trpc-client";
import { findAgentPane, focusPane, jumpToAgent, showProject } from "../../../stores/agents";
import { toastError } from "../../../stores/toasts";
import { type GoneSession, useWatchStore } from "../../../stores/watch";
import { AgentIcon } from "../../common/AgentIcon";

/** Its tab and pane when it still has one, else its project */
function goToSession(g: GoneSession): void {
  const location = findAgentPane(g.id, g.projectId);
  if (location) focusPane(g.projectId, location.tabId, location.paneId);
  else showProject(g.projectId);
}

/** Resume in its own pane (shown), or in a new tab of its project when it has none */
async function resumeGone(g: GoneSession): Promise<void> {
  const resumable = await fetchResumableCliTypes();
  const cliType = g.cliType as AgentCliType;
  const newId = await resumeSessionInto(
    { ...g, cliType },
    resumable.has(cliType),
    (data) => trpcMutate<Agent>("agents.spawn", data),
    findAgentPane(g.id, g.projectId)?.paneId,
  );
  if (newId) jumpToAgent(newId, g.projectId);
}

function useResumeGone(g: GoneSession | undefined) {
  const [busy, setBusy] = useState(false);
  const run = () => {
    if (!g) return;
    setBusy(true);
    resumeGone(g)
      .catch(toastError(`Could not resume ${labelOf(g)}`))
      .finally(() => setBusy(false));
  };
  return { busy, run };
}

const labelOf = (g: GoneSession | undefined) => (g ? (g.alias ?? g.cliType) : "Session not found");

function lastSeen(g: GoneSession): string {
  const when = g.statusChangedAt ? formatTimeAgoLong(Math.floor(g.statusChangedAt / 1000)) : "";
  return `${g.status}${when ? ` ${when}` : ""}`;
}

interface Common {
  gone: GoneSession | undefined;
  agentId: string;
  height: string;
  dragProps: object;
  dropTarget: boolean;
}

/** A pin whose session ended with nothing that continues it, collapsed: name goes to it,
 *  the accent icon resumes it */
export function WatchGoneStrip({ gone, agentId, height, dragProps, dropTarget }: Common) {
  const unwatch = useWatchStore((s) => s.unwatch);
  const toggleOpen = useWatchStore((s) => s.toggleOpen);
  const { busy, run } = useResumeGone(gone);
  const name = labelOf(gone);

  return (
    <div
      {...dragProps}
      style={{ height }}
      className={cn(
        "group flex w-9 shrink-0 cursor-grab flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-bg-secondary/40 py-2 active:cursor-grabbing",
        dropTarget && "ring-1 ring-accent",
      )}
    >
      <button
        type="button"
        onClick={() => unwatch(agentId)}
        className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-text-primary group-hover:opacity-100"
        title="Unpin"
      >
        <PinOff className="h-3 w-3" />
      </button>
      {gone && (
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="rounded p-0.5 text-accent hover:bg-accent/15 disabled:opacity-50"
          title={`Resume ${name}`}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
      {gone && (
        <button
          type="button"
          onClick={() => toggleOpen(agentId)}
          className="rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Expand"
        >
          <AgentIcon provider={gone.cliType} size={16} />
        </button>
      )}
      <button
        type="button"
        disabled={!gone}
        onClick={() => gone && goToSession(gone)}
        className="min-h-0 truncate text-[11px] font-medium text-text-muted hover:text-text-primary"
        style={{ writingMode: "vertical-rl" }}
        title={gone ? `Go to ${name} in ${gone.projectName ?? "its project"}` : undefined}
      >
        {name}
        {gone?.projectName && <span className="font-normal"> · {gone.projectName}</span>}
        {gone && <span className="font-normal"> · {lastSeen(gone)}</span>}
      </button>
    </div>
  );
}

/** The same session expanded like any card: what it was, Resume first, then Open project and Unpin */
export function WatchGoneCard({
  gone,
  agentId,
  height,
  dragProps,
  dropTarget,
}: Common & { gone: GoneSession }) {
  const unwatch = useWatchStore((s) => s.unwatch);
  const toggleOpen = useWatchStore((s) => s.toggleOpen);
  const { busy, run } = useResumeGone(gone);
  const name = labelOf(gone);
  const secondary =
    "flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-white/10 hover:text-text-primary";

  return (
    <div
      style={{ height }}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-xl border border-dashed border-border bg-bg-secondary/40",
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
          onClick={() => toggleOpen(agentId)}
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Collapse to a strip"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <AgentIcon provider={gone.cliType} size={16} />
        <span className="min-w-0 truncate text-xs font-medium text-text-primary">{name}</span>
      </div>
      <div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 pb-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-text-muted">CLI</dt>
          <dd className="text-text-secondary">{gone.cliType}</dd>
          <dt className="text-text-muted">Project</dt>
          <dd className="text-text-secondary">
            {gone.projectName ?? gone.projectId}
            {gone.branchName && <span className="text-text-muted"> · {gone.branchName}</span>}
          </dd>
          <dt className="text-text-muted">Last</dt>
          <dd className="text-text-secondary">{lastSeen(gone)}</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            {busy ? "Resuming..." : "Resume"}
          </button>
          <button type="button" onClick={() => goToSession(gone)} className={secondary}>
            <ArrowUpRight className="h-3.5 w-3.5" />
            Open project
          </button>
          <button type="button" onClick={() => unwatch(agentId)} className={secondary}>
            <PinOff className="h-3.5 w-3.5" />
            Unpin
          </button>
        </div>
      </div>
    </div>
  );
}
