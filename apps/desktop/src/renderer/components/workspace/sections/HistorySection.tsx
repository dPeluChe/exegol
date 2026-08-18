import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Coins, FileClock, GitBranch, History, Star, Terminal } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { formatTimeAgo } from "../../../lib/format";
import { trpcInvoke } from "../../../lib/trpc-client";
import { AgentIcon } from "../../common/AgentIcon";
import { EmptyState } from "../../common/EmptyState";

interface HistoryEntry {
  origin: "exegol" | "local";
  id: string;
  provider: string;
  label: string;
  task: string | null;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  status: string | null;
  score: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  oplogEntries: number;
  hasFinalOutput: boolean;
  archived: boolean;
  sessionId: string | null;
}

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 0, label: "All" },
];

function duration(entry: HistoryEntry): string | null {
  if (!entry.startedAt || !entry.endedAt) return null;
  const mins = Math.round((entry.endedAt - entry.startedAt) / 60);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Only outcomes we actually recorded. A local session has none, and inventing
 *  one would make the two sources indistinguishable — which is the point. */
function statusTone(status: string | null): string {
  if (status === "completed") return "text-success";
  if (status === "failed" || status === "crashed") return "text-danger";
  return "text-text-muted";
}

export function HistorySection() {
  const { projectId } = useProjectContext();
  const [days, setDays] = useState(30);
  const [cliType, setCliType] = useState<string | null>(null);
  const [openOutput, setOpenOutput] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["history", projectId, days, cliType],
    queryFn: () =>
      trpcInvoke<{ entries: HistoryEntry[]; providers: string[] }>("history.list", {
        projectId,
        days,
        cliType: cliType ?? undefined,
      }),
    enabled: !!projectId,
    staleTime: 15_000,
  });

  const entries = data?.entries ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <History className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-semibold text-text-primary">Session history</span>
        <span className="text-[11px] text-text-muted">
          {entries.length} {entries.length === 1 ? "session" : "sessions"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCliType(null)}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] transition-colors",
              cliType === null
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-muted hover:border-accent/30",
            )}
          >
            All agents
          </button>
          {(data?.providers ?? []).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCliType(p)}
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] transition-colors",
                cliType === p
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:border-accent/30",
              )}
            >
              <AgentIcon provider={p} size={11} />
              {p}
            </button>
          ))}
          <span className="mx-1 h-3 w-px bg-border" />
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setDays(r.days)}
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] transition-colors",
                days === r.days
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:border-accent/30",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && <p className="text-[11px] text-text-muted">Reading session stores…</p>}

        {!isLoading && entries.length === 0 && (
          <EmptyState
            icon={<FileClock className="h-6 w-6" />}
            title="No sessions yet for this repo"
            description="Sessions you run through Exegol appear here, together with whatever the installed CLIs recorded for this directory on their own."
          />
        )}

        <div className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-bg-secondary px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <AgentIcon provider={entry.provider} size={16} />
                <span className="truncate text-xs font-medium text-text-primary">
                  {entry.label}
                </span>

                {/* Where the record comes from, because it decides what we can
                    show: Exegol knows the score and the spend, a CLI's own
                    store knows only that the session happened. */}
                {entry.origin === "local" && (
                  <span
                    className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted"
                    title="Recorded by the CLI itself — not launched from Exegol"
                  >
                    outside Exegol
                  </span>
                )}
                {entry.archived && (
                  <span className="shrink-0 text-[9px] text-text-muted">archived</span>
                )}
                {entry.status && (
                  <span className={cn("shrink-0 text-[10px]", statusTone(entry.status))}>
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
                {duration(entry) && <span>{duration(entry)}</span>}
                {entry.score !== null && (
                  <span className="flex items-center gap-0.5">
                    <Star className="h-2.5 w-2.5" />
                    {entry.score.toFixed(2)}
                  </span>
                )}
                {entry.inputTokens + entry.outputTokens > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Coins className="h-2.5 w-2.5" />
                    {((entry.inputTokens + entry.outputTokens) / 1000).toFixed(1)}k
                    {entry.costUsd > 0 && <span> · ${entry.costUsd.toFixed(2)}</span>}
                  </span>
                )}
                {entry.branch && (
                  <span className="flex items-center gap-0.5">
                    <GitBranch className="h-2.5 w-2.5" />
                    {entry.branch}
                  </span>
                )}
                {entry.oplogEntries > 0 && <span>{entry.oplogEntries} ops</span>}
                {entry.hasFinalOutput && (
                  <button
                    type="button"
                    onClick={() => setOpenOutput(openOutput === entry.id ? null : entry.id)}
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10 hover:text-text-primary"
                  >
                    <Terminal className="h-2.5 w-2.5" />
                    {openOutput === entry.id ? "hide output" : "output"}
                  </button>
                )}
              </div>

              {openOutput === entry.id && <FinalOutput agentId={entry.id} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
