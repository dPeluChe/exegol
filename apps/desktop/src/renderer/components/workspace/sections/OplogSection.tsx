import type { OplogEntry } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import {
  FileEdit,
  FolderGit,
  GitBranch,
  GitCommit,
  History,
  Loader2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useProjectOplog, useUndoOplog } from "../../../hooks/use-trpc";
import { ConfirmDialog, EmptyState, LoadingSpinner } from "../../common";

// ─── Operation icon mapping ─────────────────────────────────────────────────

const OPERATION_ICONS: Record<string, typeof GitCommit> = {
  commit: GitCommit,
  branch_create: GitBranch,
  worktree_create: FolderGit,
  file_write: FileEdit,
  revert: RotateCcw,
};

const OPERATION_COLORS: Record<string, string> = {
  commit: "text-green-400",
  branch_create: "text-blue-400",
  worktree_create: "text-purple-400",
  file_write: "text-yellow-400",
  revert: "text-orange-400",
};

// ─── Timeline Entry ─────────────────────────────────────────────────────────

function OplogTimelineEntry({
  entry,
  onUndo,
  isUndoing,
}: {
  entry: OplogEntry;
  onUndo: (id: string) => void;
  isUndoing: boolean;
}) {
  const Icon = OPERATION_ICONS[entry.operation] ?? History;
  const iconColor = OPERATION_COLORS[entry.operation] ?? "text-text-muted";
  const canUndo = entry.refBefore && entry.operation !== "revert";

  const timeAgo = useMemo(() => {
    const diff = Math.floor(Date.now() / 1000) - entry.createdAt;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }, [entry.createdAt]);

  return (
    <div className="flex items-start gap-3 group">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-secondary",
            iconColor,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">
            {entry.operation.replace("_", " ")}
          </span>
          <span className="text-[10px] text-text-muted">{timeAgo}</span>
          <span className="text-[10px] text-text-muted">agent:{entry.agentId.slice(0, 6)}</span>
        </div>

        <p className="mt-0.5 text-[11px] text-text-muted">{entry.description}</p>

        {(entry.refBefore || entry.refAfter) && (
          <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-text-muted">
            {entry.refBefore && (
              <span className="rounded bg-bg-primary px-1.5 py-0.5">
                {entry.refBefore.slice(0, 8)}
              </span>
            )}
            {entry.refBefore && entry.refAfter && <span>&rarr;</span>}
            {entry.refAfter && (
              <span className="rounded bg-bg-primary px-1.5 py-0.5">
                {entry.refAfter.slice(0, 8)}
              </span>
            )}
          </div>
        )}

        {canUndo && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5 h-6 gap-1 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onUndo(entry.id)}
            disabled={isUndoing}
          >
            {isUndoing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Undo2 className="h-3 w-3" />
            )}
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Filter Controls ────────────────────────────────────────────────────────

const OPERATION_FILTERS = [
  { key: "all", label: "All" },
  { key: "commit", label: "Commits" },
  { key: "branch_create", label: "Branches" },
  { key: "worktree_create", label: "Worktrees" },
  { key: "revert", label: "Reverts" },
] as const;

// ─── Main Section ───────────────────────────────────────────────────────────

export function OplogSection() {
  const { projectId } = useProjectContext();
  const { data: entries, isLoading } = useProjectOplog(projectId);
  const undoMutation = useUndoOplog();
  const [filter, setFilter] = useState<string>("all");
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);

  const handleUndo = useCallback((oplogId: string) => {
    setConfirmUndoId(oplogId);
  }, []);

  const executeUndo = useCallback(() => {
    if (confirmUndoId) {
      undoMutation.mutate(confirmUndoId);
      setConfirmUndoId(null);
    }
  }, [confirmUndoId, undoMutation]);

  const filteredEntries = useMemo(
    () =>
      filter === "all" ? (entries ?? []) : (entries ?? []).filter((e) => e.operation === filter),
    [entries, filter],
  );

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<History className="h-8 w-8 text-text-muted" />}
          title="No project selected"
          description="Select a project to view the operations log."
        />
      </div>
    );
  }

  if (isLoading && !entries) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner label="Loading oplog..." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <History className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-[11px] font-medium text-text-muted">Operations Log</span>

        <div className="flex-1" />

        <div className="flex rounded bg-bg-primary">
          {OPERATION_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "px-2 py-1 text-[10px] font-medium transition-colors",
                key === OPERATION_FILTERS[0].key && "rounded-l",
                key === OPERATION_FILTERS[OPERATION_FILTERS.length - 1].key && "rounded-r",
                filter === key ? "bg-accent text-white" : "text-text-muted hover:text-text-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredEntries.length > 0 && (
          <span className="text-[10px] text-text-muted">{filteredEntries.length} entries</span>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<History className="h-8 w-8 text-text-muted" />}
              title="No operations recorded"
              description="Agent git operations will appear here as they happen."
            />
          </div>
        ) : (
          <div className="space-y-0">
            {filteredEntries.map((entry) => (
              <OplogTimelineEntry
                key={entry.id}
                entry={entry}
                onUndo={handleUndo}
                isUndoing={undoMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Undo confirmation dialog */}
      <ConfirmDialog
        open={confirmUndoId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUndoId(null);
        }}
        title="Undo Operation"
        description="This will create a new revert commit restoring the repository to its previous state. This action cannot be undone."
        confirmLabel="Revert"
        variant="destructive"
        onConfirm={executeUndo}
      />
    </div>
  );
}
