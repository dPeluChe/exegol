import type { OplogSnapshot } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { GitCommitVertical, History, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { useOplogSnapshots, useRestoreOplogSnapshot } from "../../../hooks/use-trpc";
import { formatTimeAgoLong } from "../../../lib/format";
import { ConfirmDialog, EmptyState, LoadingSpinner } from "../../common";

/**
 * T129 — Oplog v2. This timeline reads turn snapshots straight off the
 * project's hidden oplog chain (`refs/exegol/oplog`, git2 hidden ref) —
 * there is no parallel DB store, git is the source of truth.
 */

const OPERATION_COLORS: Record<string, string> = {
  AgentTurn: "text-blue-400",
  PipelineStep: "text-purple-400",
  Promote: "text-green-400",
  Race: "text-orange-400",
};

function SnapshotEntry({
  snapshot,
  onRestore,
  isRestoring,
}: {
  snapshot: OplogSnapshot;
  onRestore: (sha: string) => void;
  isRestoring: boolean;
}) {
  const iconColor = OPERATION_COLORS[snapshot.operation] ?? "text-text-muted";
  const timeAgo = formatTimeAgoLong(snapshot.timestamp);

  return (
    <div className="flex items-start gap-3 group">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-secondary",
            iconColor,
          )}
        >
          <GitCommitVertical className="h-3.5 w-3.5" />
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{snapshot.operation}</span>
          <span className="text-[10px] text-text-muted">turn {snapshot.turnIndex}</span>
          <span className="text-[10px] text-text-muted">{timeAgo}</span>
          {snapshot.agentId && (
            <span className="text-[10px] text-text-muted">
              agent:{snapshot.agentId.slice(0, 6)}
            </span>
          )}
          {snapshot.provider && (
            <span className="rounded bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-muted">
              {snapshot.provider}
            </span>
          )}
        </div>

        {snapshot.description && (
          <p className="mt-0.5 text-[11px] text-text-muted">{snapshot.description}</p>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-text-muted">
          <span className="rounded bg-bg-primary px-1.5 py-0.5">{snapshot.sha.slice(0, 8)}</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-6 gap-1 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onRestore(snapshot.sha)}
          disabled={isRestoring}
        >
          {isRestoring ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Restore this turn
        </Button>
      </div>
    </div>
  );
}

export function OplogSnapshotTimeline({ projectId }: { projectId: string | null }) {
  const { data: snapshots, isLoading } = useOplogSnapshots(projectId);
  const restoreMutation = useRestoreOplogSnapshot(projectId);
  const [confirmSha, setConfirmSha] = useState<string | null>(null);

  const handleRestore = useCallback((sha: string) => {
    setConfirmSha(sha);
  }, []);

  const executeRestore = useCallback(() => {
    if (confirmSha) {
      restoreMutation.mutate(confirmSha);
      setConfirmSha(null);
    }
  }, [confirmSha, restoreMutation]);

  if (isLoading && !snapshots) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner label="Loading turn snapshots..." />
      </div>
    );
  }

  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<History className="h-8 w-8 text-text-muted" />}
          title="No turn snapshots yet"
          description="Each agent turn (pipeline step, for now) snapshots the worktree here — no commits needed to undo it."
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-0">
          {snapshots.map((snapshot) => (
            <SnapshotEntry
              key={snapshot.sha}
              snapshot={snapshot}
              onRestore={handleRestore}
              isRestoring={restoreMutation.isPending}
            />
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSha !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSha(null);
        }}
        title="Restore Turn Snapshot"
        description="This will create a new commit restoring the worktree to this turn's state. This action cannot be undone."
        confirmLabel="Restore"
        variant="destructive"
        onConfirm={executeRestore}
      />
    </>
  );
}
