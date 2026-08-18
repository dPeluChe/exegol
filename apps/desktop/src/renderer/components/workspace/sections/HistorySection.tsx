import type { HistoryEntry } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Coins, FileClock, GitBranch, History, Terminal } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { formatCost, formatDuration, formatTimeAgo, formatTokens } from "../../../lib/format";
import { SEMANTIC_BADGE, statusToSemantic } from "../../../lib/semantic-colors";
import { trpcInvoke } from "../../../lib/trpc-client";
import { EmptyState, FilterChip, ScoreBadge } from "../../common";
import { AgentIcon } from "../../common/AgentIcon";

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

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && <p className="text-[11px] text-text-muted">Reading session stores…</p>}

        {!isLoading && entries?.length === 0 && (
          <EmptyState
            icon={<FileClock className="h-6 w-6" />}
            title="No sessions yet for this repo"
            description="Sessions you run through Exegol appear here, together with whatever the installed CLIs recorded for this directory on their own."
          />
        )}

        <div className="flex flex-col gap-1.5">
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
    <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
      <div className="flex items-center gap-2">
        <AgentIcon provider={entry.provider} size={16} />
        <span className="truncate text-xs font-medium text-text-primary">{entry.label}</span>

        {/* Where the record comes from, because it decides what we can show:
            Exegol knows the score and the spend, a CLI's own store knows only
            that the session happened. */}
        {entry.origin === "local" && (
          <span
            className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted"
            title="Recorded by the CLI itself — not launched from Exegol"
          >
            outside Exegol
          </span>
        )}
        {entry.archived && <span className="shrink-0 text-[9px] text-text-muted">archived</span>}
        {entry.status && (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
              SEMANTIC_BADGE[statusToSemantic(entry.status)],
            )}
          >
            {entry.status}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-text-muted">
          {formatTimeAgo(entry.endedAt ?? entry.startedAt)}
        </span>
      </div>

      {entry.task && entry.task !== entry.label && (
        <p className="mt-0.5 truncate text-[11px] text-text-muted">{entry.task}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
        {elapsed && <span>{elapsed}</span>}
        {entry.score !== null && <ScoreBadge score={entry.score} />}
        {tokens > 0 && (
          <span className="flex items-center gap-0.5">
            <Coins className="h-2.5 w-2.5" />
            {formatTokens(tokens)}
            {entry.costUsd > 0 && <span> · {formatCost(entry.costUsd)}</span>}
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
            className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10 hover:text-text-primary"
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
