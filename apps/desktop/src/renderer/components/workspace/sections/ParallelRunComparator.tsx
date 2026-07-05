import type { LoserCleanupResult, ParallelRun, ParallelRunDetails } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  Trophy,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { formatCost, formatTokens } from "../../../lib/format";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { AgentIcon } from "../../common/AgentIcon";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { EmptyState } from "../../common/EmptyState";

interface ParallelRunComparatorProps {
  runId: string;
  onBack: () => void;
}

export function ParallelRunComparator({ runId, onBack }: ParallelRunComparatorProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["parallelRunDetails", runId],
    queryFn: () => trpcInvoke<ParallelRunDetails>("agents.getParallelRunDetails", { runId }),
    refetchInterval: (q) => (q.state.data?.run.status === "running" ? 10_000 : false),
  });

  // T131 — "Promote & Clean" is one action: promote marks the winner and
  // auto-removes loser worktrees/branches; dirty losers come back in the
  // report and get a confirm prompt before force-deleting.
  const [dirtyPrompt, setDirtyPrompt] = useState<{
    agentId: string;
    dirty: LoserCleanupResult[];
  } | null>(null);

  const promote = useMutation({
    mutationFn: ({ agentId, force }: { agentId: string; force?: boolean }) =>
      trpcMutate<{ success: boolean; cleanup: LoserCleanupResult[] }>(
        "agents.promoteParallelAgent",
        { runId, agentId, force },
      ),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["parallelRunDetails", runId] });
      queryClient.invalidateQueries({ queryKey: ["parallelRuns"] });
      const dirty = result.cleanup.filter((c) => c.dirty && !c.cleaned);
      if (dirty.length > 0 && !variables.force) {
        setDirtyPrompt({ agentId: variables.agentId, dirty });
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<XCircle className="h-6 w-6 text-error" />}
        title="Could not load parallel run"
        description={error instanceof Error ? error.message : "Unknown error"}
        className="h-full"
      />
    );
  }

  const { run, columns } = data;
  const isRunning = run.status === "running";

  return (
    <div className="flex h-full flex-col">
      <ComparatorHeader run={run} onBack={onBack} />
      <div className="flex-1 overflow-auto p-4">
        {columns.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6 text-text-muted" />}
            title="No variants to compare"
            description="The agents may have been deleted."
            className="h-full"
          />
        ) : (
          <div className="grid auto-cols-fr gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {columns.map((col) => (
              <ColumnCard
                key={col.agent.id}
                column={col}
                isPromoted={run.promotedAgentId === col.agent.id}
                isRunning={isRunning}
                runSettled={!isRunning}
                onPromote={() => promote.mutate({ agentId: col.agent.id })}
                pending={promote.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={dirtyPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setDirtyPrompt(null);
        }}
        title="Uncommitted changes in loser worktrees"
        description={`${dirtyPrompt?.dirty.length ?? 0} loser worktree(s) have uncommitted changes and were kept. Delete them anyway?`}
        confirmLabel="Delete anyway"
        variant="destructive"
        onConfirm={() => {
          if (dirtyPrompt) promote.mutate({ agentId: dirtyPrompt.agentId, force: true });
          setDirtyPrompt(null);
        }}
      />
    </div>
  );
}

function ComparatorHeader({ run, onBack }: { run: ParallelRun; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <button
        type="button"
        onClick={onBack}
        className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-text-muted hover:bg-white/5 hover:text-text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>
      <Layers className="h-4 w-4 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-text-primary">
          {run.taskDescription}
        </p>
        <p className="text-[10px] text-text-muted">
          {run.agentIds.length} variants · status:{" "}
          <span className={cn("font-medium", statusColor(run.status))}>{run.status}</span>
          {run.promotedAgentId && " · promoted"}
        </p>
      </div>
    </div>
  );
}

function statusColor(status: ParallelRun["status"]): string {
  switch (status) {
    case "completed":
      return "text-success";
    case "failed":
      return "text-error";
    case "cancelled":
      return "text-text-muted";
    default:
      return "text-accent";
  }
}

interface ColumnCardProps {
  column: ParallelRunDetails["columns"][number];
  isPromoted: boolean;
  isRunning: boolean;
  runSettled: boolean;
  onPromote: () => void;
  pending: boolean;
}

function ColumnCard({
  column,
  isPromoted,
  isRunning,
  runSettled,
  onPromote,
  pending,
}: ColumnCardProps) {
  const { agent, diffStat, score, cost, durationSeconds, lastLines } = column;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-bg-secondary p-3",
        isPromoted ? "border-success/60 ring-1 ring-success/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <AgentIcon provider={agent.cliType} size={18} fallback={agent.cliType[0]?.toUpperCase()} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-text-primary">{agent.cliType}</p>
          <p className="text-[10px] text-text-muted">{agent.status}</p>
        </div>
        {isPromoted && <Trophy className="h-4 w-4 text-success" />}
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <Stat
          label="Diff"
          value={diffStat ? `+${diffStat.insertions} / -${diffStat.deletions}` : "—"}
          detail={diffStat ? `${diffStat.filesChanged} files` : undefined}
        />
        <Stat
          label="Score"
          value={score ? `${Math.round(score.overallScore * 100)}%` : "—"}
          detail={score?.exitReason}
        />
        <Stat
          label="Cost"
          value={cost ? formatCost(cost.totalCostUsd) : "—"}
          detail={
            cost ? `${formatTokens(cost.totalInputTokens + cost.totalOutputTokens)} tok` : undefined
          }
        />
        <Stat
          label="Duration"
          value={durationSeconds != null ? formatDuration(durationSeconds) : "—"}
          detail={score ? `${score.turnsUsed} turns` : undefined}
        />
      </div>

      {lastLines.length > 0 && (
        <div className="mt-1 max-h-24 overflow-hidden rounded bg-bg-primary/70 p-2 font-mono text-[9px] leading-tight text-text-muted">
          {lastLines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lastLines is a frozen scrollback tail
            <div key={`${agent.id}-line-${i}-${line.slice(0, 16)}`} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex gap-1.5 pt-2">
        <Button
          variant={isPromoted ? "ghost" : "default"}
          size="sm"
          disabled={pending || isRunning}
          onClick={onPromote}
          className="h-7 flex-1 gap-1 text-[10px]"
          title={
            isRunning
              ? "Wait for all variants to finish before promoting"
              : isPromoted
                ? "Already promoted — calling again leaves state unchanged"
                : "Promote this variant as the winner and clean up the losers' worktrees/branches"
          }
        >
          {isPromoted ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Promoted
            </>
          ) : (
            <>
              <Trophy className="h-3 w-3" />
              {pending ? "..." : "Promote & Clean"}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("exegol:focus-agent", { detail: { agentId: agent.id } }),
            );
            window.dispatchEvent(
              new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
            );
          }}
          className="h-7 gap-1 px-2 text-[10px]"
          title="Open this agent's terminal pane"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </Button>
      </div>

      {runSettled && !isPromoted && score && score.taskCompleted === false && (
        <p className="text-[9px] text-text-muted">Task did not complete.</p>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded border border-border/60 bg-bg-primary/40 p-1.5">
      <p className="text-[9px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-text-primary">{value}</p>
      {detail && <p className="text-[9px] text-text-muted">{detail}</p>}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
