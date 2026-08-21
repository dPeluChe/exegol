import type { HistoryEntry } from "@exegol/shared";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { FileClock, GitBranch, History, Terminal } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { formatCost, formatDuration, formatTimeAgo, formatTokens } from "../../../lib/format";
import { SEMANTIC_BADGE, statusToSemantic } from "../../../lib/semantic-colors";
import { trpcInvoke } from "../../../lib/trpc-client";
import { EmptyState, FilterChip, ScoreBadge } from "../../common";
import { AgentIcon } from "../../common/AgentIcon";

/**
 * A bare "18%" is a number nobody can place, and a native `title` is barely
 * discoverable — so the explanation is a real tooltip, and it says both what the
 * score measures AND why most rows do not have one.
 */
function ScoreExplainer({ score }: { score: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 cursor-help items-center gap-1">
          <span className="text-[9px] text-text-muted">score</span>
          <ScoreBadge score={score} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[260px]">
        <p className="font-medium">Exegol&apos;s score for this session</p>
        <p className="mt-1 text-text-secondary">
          Graded when the agent exited: did the work compile, did tests pass, was the task
          completed, how many files changed, and how it ended.
        </p>
        <p className="mt-1 text-text-muted">
          Only sessions Exegol launched have one — a CLI&apos;s own history records that a session
          happened, never how it went.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 0, label: "All" },
];

/**
 * T181 — what has been done on this repo: Exegol's own sessions plus whatever
 * the installed CLIs recorded for the same directories on their own.
 */
export function HistorySection() {
  const { projectId } = useProjectContext();
  const [days, setDays] = useState(30);
  const [cliType, setCliType] = useState<string | null>(null);

  // `cliType` is deliberately NOT in the key: it is a facet over data already
  // in hand, and re-keying on it would rescan every CLI's store on a click.
  const { data, isLoading } = useQuery({
    queryKey: ["history", projectId, days],
    queryFn: () =>
      trpcInvoke<{ entries: HistoryEntry[]; providers: string[] }>("history.list", {
        projectId,
        days,
      }),
    enabled: !!projectId,
    staleTime: 15_000,
  });

  const entries = useMemo(
    () => (cliType ? (data?.entries ?? []).filter((e) => e.provider === cliType) : data?.entries),
    [data?.entries, cliType],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <History className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-semibold text-text-primary">Session history</span>
        <span className="text-[11px] text-text-muted">
          {entries?.length ?? 0} {entries?.length === 1 ? "session" : "sessions"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <FilterChip active={cliType === null} onClick={() => setCliType(null)}>
            All agents
          </FilterChip>
          {(data?.providers ?? []).map((provider) => (
            <FilterChip
              key={provider}
              active={cliType === provider}
              onClick={() => setCliType(provider)}
            >
              <span className="flex items-center gap-1">
                <AgentIcon provider={provider} size={11} />
                {provider}
              </span>
            </FilterChip>
          ))}
          <span className="mx-1 h-3 w-px bg-border" />
          {RANGES.map((range) => (
            <FilterChip
              key={range.label}
              active={days === range.days}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && <p className="text-[11px] text-text-muted">Reading session stores…</p>}

        {!isLoading && entries?.length === 0 && (
          <EmptyState
            icon={<FileClock className="h-6 w-6" />}
            title="No sessions yet for this repo"
            description="Sessions you run through Exegol appear here, together with whatever the installed CLIs recorded for this directory on their own."
          />
        )}

        <div className="flex flex-col gap-1">
          {entries?.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Memoized: expanding one row's output must not re-render the whole timeline. */
const HistoryRow = memo(function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [showOutput, setShowOutput] = useState(false);
  const elapsed = formatDuration(entry.startedAt, entry.endedAt);
  const tokens = entry.inputTokens + entry.outputTokens;

  return (
    <div className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5">
      {/* One line: who, what, how it went, when. The detail line below only
          appears when there is detail — a local session has almost none. */}
      <div className="flex items-center gap-2">
        <AgentIcon provider={entry.provider} size={14} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">{entry.label}</span>

        {entry.origin === "local" && (
          <span
            className="shrink-0 text-[9px] text-text-muted"
            title="Recorded by the CLI itself — not launched from Exegol"
          >
            outside
          </span>
        )}
        {entry.archived && <span className="shrink-0 text-[9px] text-text-muted">archived</span>}
        {entry.status && (
          <span
            className={cn(
              "shrink-0 rounded px-1 py-px text-[9px]",
              SEMANTIC_BADGE[statusToSemantic(entry.status)],
            )}
          >
            {entry.status}
          </span>
        )}
        {entry.score !== null && <ScoreExplainer score={entry.score} />}
        <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
          {formatTimeAgo(entry.endedAt ?? entry.startedAt)}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[10px] text-text-muted">
        {elapsed && <span title="From first activity to last">{elapsed}</span>}
        {tokens > 0 && (
          <span>
            {formatTokens(tokens)}
            {entry.costUsd > 0 && ` · ${formatCost(entry.costUsd)}`}
          </span>
        )}
        {entry.branch && (
          <span className="flex items-center gap-0.5">
            <GitBranch className="h-2.5 w-2.5" />
            {entry.branch}
          </span>
        )}
        {entry.oplogEntries > 0 && <span>{entry.oplogEntries} ops</span>}
        {/* A local row has no score and no token count; the transcript size is
            the only signal of how much happened in it. */}
        {entry.origin === "local" && entry.sizeBytes > 0 && (
          <span title="Transcript size on disk">
            {(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB
          </span>
        )}
        {entry.version && <span title="CLI version that ran it">v{entry.version}</span>}
        {entry.hasFinalOutput && (
          <button
            type="button"
            onClick={() => setShowOutput((v) => !v)}
            className="flex items-center gap-0.5 rounded px-1 hover:bg-white/10 hover:text-text-primary"
          >
            <Terminal className="h-2.5 w-2.5" />
            {showOutput ? "hide output" : "output"}
          </button>
        )}
      </div>

      {showOutput && <FinalOutput agentId={entry.id} />}
    </div>
  );
});

/** The tail of what the session last said — a score with no output is a number
 *  nobody can check. */
function FinalOutput({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["history", "finalOutput", agentId],
    queryFn: () => trpcInvoke<{ output: string | null }>("history.finalOutput", { agentId }),
    staleTime: Number.POSITIVE_INFINITY, // a past session never changes
  });

  if (isLoading) return <p className="mt-1.5 text-[10px] text-text-muted">Loading…</p>;
  if (!data?.output) return <p className="mt-1.5 text-[10px] text-text-muted">No output stored.</p>;

  return (
    <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-primary p-2 font-mono text-[10px] leading-relaxed text-text-secondary">
      {data.output}
    </pre>
  );
}
