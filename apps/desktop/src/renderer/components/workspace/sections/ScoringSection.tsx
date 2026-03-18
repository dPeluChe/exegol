import type { AgentScoreRow } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Award, CheckCircle, FileEdit, XCircle, Zap } from "lucide-react";
import { useMemo } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useProjectScores, useScoringStats } from "../../../hooks/use-trpc";
import { EmptyState, LoadingSpinner } from "../../common";

// ─── Score Badge ────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 70
      ? "bg-green-500/20 text-green-400"
      : pct >= 40
        ? "bg-yellow-500/20 text-yellow-400"
        : "bg-red-500/20 text-red-400";

  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums", color)}>
      {pct}%
    </span>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-text-primary">{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

// ─── Bool indicator ─────────────────────────────────────────────────────────

function BoolIndicator({ value, label }: { value: boolean | null; label: string }) {
  if (value === null) {
    return <span className="text-[11px] text-text-muted">{label}: ?</span>;
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-[11px]",
        value ? "text-green-400" : "text-red-400",
      )}
    >
      {value ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

// ─── Score Row ──────────────────────────────────────────────────────────────

function ScoreRow({ score }: { score: AgentScoreRow }) {
  const timeAgo = useMemo(() => {
    const diff = Math.floor(Date.now() / 1000) - score.scoredAt;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }, [score.scoredAt]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2">
      <ScoreBadge score={score.overallScore} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text-primary">
          {score.agentId.slice(0, 8)}...
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          <BoolIndicator value={score.compiles} label="Build" />
          <BoolIndicator value={score.testsPassed} label="Tests" />
          <BoolIndicator value={score.taskCompleted} label="Done" />
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <FileEdit className="h-3 w-3" />
          {score.filesChanged} files
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {score.turnsUsed} turns
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            score.exitReason === "success"
              ? "bg-green-500/10 text-green-400"
              : score.exitReason === "stopped"
                ? "bg-yellow-500/10 text-yellow-400"
                : "bg-red-500/10 text-red-400",
          )}
        >
          {score.exitReason}
        </span>
        <span className="text-[10px] text-text-muted">{timeAgo}</span>
      </div>
    </div>
  );
}

// ─── CLI Performance Table ──────────────────────────────────────────────────

function CliPerformanceTable({
  data,
}: {
  data: Array<{ cliType: string; count: number; avgScore: number; successRate: number }>;
}) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-secondary">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-text-muted">
        Performance by CLI Type
      </div>
      <div className="divide-y divide-border">
        {data.map((row) => (
          <div key={row.cliType} className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-text-primary">{row.cliType}</span>
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span>{row.count} runs</span>
              <ScoreBadge score={row.avgScore} />
              <span className={row.successRate >= 0.7 ? "text-green-400" : "text-yellow-400"}>
                {Math.round(row.successRate * 100)}% success
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function ScoringSection() {
  const { projectId } = useProjectContext();
  const { data: stats, isLoading: statsLoading } = useScoringStats(projectId);
  const { data: scores, isLoading: scoresLoading } = useProjectScores(projectId);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Award className="h-8 w-8 text-text-muted" />}
          title="No project selected"
          description="Select a project to view scoring data."
        />
      </div>
    );
  }

  const isLoading = statsLoading || scoresLoading;

  if (isLoading && !stats && !scores) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner label="Loading scores..." />
      </div>
    );
  }

  if (!stats || stats.totalScored === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Award className="h-8 w-8 text-text-muted" />}
          title="No scores yet"
          description="Scores are recorded automatically when agents complete their work."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 gap-4">
      {/* Stats overview */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard label="Total Scored" value={stats.totalScored} />
        <MetricCard
          label="Avg Score"
          value={`${Math.round(stats.avgScore * 100)}%`}
          sub={stats.avgScore >= 0.7 ? "Good" : stats.avgScore >= 0.4 ? "Fair" : "Needs work"}
        />
        <MetricCard label="Success Rate" value={`${Math.round(stats.successRate * 100)}%`} />
        <MetricCard label="Avg Turns" value={stats.avgTurns} />
        <MetricCard
          label="Avg Tokens"
          value={
            stats.avgTokens > 1000 ? `${Math.round(stats.avgTokens / 1000)}k` : stats.avgTokens
          }
        />
      </div>

      {/* CLI performance */}
      <CliPerformanceTable data={stats.byCliType} />

      {/* Recent scores */}
      <div>
        <h3 className="mb-2 text-xs font-medium text-text-muted">Recent Agent Scores</h3>
        <div className="space-y-2">
          {scores?.map((score) => (
            <ScoreRow key={score.agentId} score={score} />
          ))}
        </div>
      </div>
    </div>
  );
}
