import type { Agent, AgentCliType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { PinOff, RotateCcw } from "lucide-react";
import { useState } from "react";
import { fetchResumableCliTypes, resumeSessionInto } from "../../../hooks/use-resume-agent";
import { formatTimeAgoLong } from "../../../lib/format";
import { trpcMutate } from "../../../lib/trpc-client";
import { findAgentPane } from "../../../stores/agents";
import { toastError } from "../../../stores/toasts";
import { type GoneSession, useWatchStore } from "../../../stores/watch";
import { AgentIcon } from "../../common/AgentIcon";

/** Resume a pinned session that has no live continuation, in its pane or in its project */
async function resumeGone(g: GoneSession): Promise<void> {
  const resumable = await fetchResumableCliTypes();
  const cliType = g.cliType as AgentCliType;
  await resumeSessionInto(
    { ...g, cliType },
    resumable.has(cliType),
    (data) => trpcMutate<Agent>("agents.spawn", data),
    findAgentPane(g.id, g.projectId)?.paneId,
  );
}

/** A pin whose session ended with nothing that continues it: what it was, Resume and Unpin */
export function WatchGoneStrip({
  gone,
  agentId,
  height,
  dragProps,
  dropTarget,
}: {
  gone: GoneSession | undefined;
  agentId: string;
  height: string;
  dragProps: object;
  dropTarget: boolean;
}) {
  const unwatch = useWatchStore((s) => s.unwatch);
  const [busy, setBusy] = useState(false);
  const name = gone ? (gone.alias ?? gone.cliType) : "Session not found";
  const when = gone?.statusChangedAt
    ? formatTimeAgoLong(Math.floor(gone.statusChangedAt / 1000))
    : "";
  const title = gone
    ? `${name}${gone.projectName ? ` · ${gone.projectName}` : ""}: ${gone.status}${when ? ` ${when}` : ""}`
    : "No record of this session is left";

  return (
    <div
      {...dragProps}
      style={{ height }}
      title={title}
      className={cn(
        "group flex w-9 shrink-0 cursor-grab flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-bg-secondary/40 py-2 active:cursor-grabbing",
        dropTarget && "ring-1 ring-accent",
      )}
    >
      <button
        type="button"
        onClick={() => unwatch(agentId)}
        className="rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Unpin"
      >
        <PinOff className="h-3 w-3" />
      </button>
      {gone && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            resumeGone(gone)
              .catch(toastError(`Could not resume ${name}`))
              .finally(() => setBusy(false));
          }}
          className="rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary disabled:opacity-50"
          title={`Resume ${name}`}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
      {gone && <AgentIcon provider={gone.cliType} size={16} />}
      <span
        className="min-h-0 truncate text-[11px] font-medium text-text-muted"
        style={{ writingMode: "vertical-rl" }}
      >
        {name}
        {gone?.projectName && <span className="font-normal"> · {gone.projectName}</span>}
        {gone && (
          <span className="font-normal">
            {" "}
            · {gone.status}
            {when && ` ${when}`}
          </span>
        )}
      </span>
    </div>
  );
}
