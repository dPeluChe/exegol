import { Button, cn } from "@exegol/ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns,
  GitCompare,
  Info,
  Loader2,
  RefreshCw,
  Rows,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  type ReviewSignal,
  type ReviewSummary,
  useAddDiffComment,
  useDeleteDiffComment,
  useDiff,
  useDiffComments,
  useReviewSummary,
  useToggleResolveDiffComment,
} from "../../../hooks/use-trpc";
import { EmptyState } from "../../common/EmptyState";
import { DiffFileView } from "./diff/DiffFileView";
import { type DiffFile, parseUnifiedDiff } from "./diff/diff-parser";

type DiffMode = "unstaged" | "staged";
type ViewMode = "unified" | "split";

// ─── Signal icon helper ────────────────────────────────────────────────────

const RISK_COLORS: Record<ReviewSignal["type"], { border: string; badge: string }> = {
  info: { border: "border-border", badge: "bg-blue-400/15 text-blue-400" },
  warn: { border: "border-yellow-400/30", badge: "bg-yellow-400/15 text-yellow-400" },
  risk: { border: "border-red-400/30", badge: "bg-red-400/15 text-red-400" },
};

const SIGNAL_STYLES: Record<
  ReviewSignal["type"],
  { icon: typeof Info; color: string; bg: string }
> = {
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-400/10" },
  warn: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-400/10" },
  risk: { icon: ShieldAlert, color: "text-red-400", bg: "bg-red-400/10" },
};

// ─── Review Summary Banner ─────────────────────────────────────────────────

function ReviewSummaryBanner({ summary }: { summary: ReviewSummary }) {
  const [expanded, setExpanded] = useState(true);

  const riskLevel = summary.signals.some((s) => s.type === "risk")
    ? "risk"
    : summary.signals.some((s) => s.type === "warn")
      ? "warn"
      : "info";
  const colors = RISK_COLORS[riskLevel];

  const topTypes = useMemo(
    () =>
      Object.entries(summary.filesByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [summary.filesByType],
  );
  const typeCount = Object.keys(summary.filesByType).length;

  return (
    <div className={cn("rounded border mb-3", colors.border, "bg-bg-secondary/50")}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
        )}
        <span className="text-[11px] font-semibold text-text-primary">Review Summary</span>
        <span className="text-[10px] text-text-muted">
          {summary.totalFiles} file{summary.totalFiles !== 1 ? "s" : ""}
        </span>
        {summary.additions > 0 && (
          <span className="text-[10px] text-green-400">+{summary.additions}</span>
        )}
        {summary.deletions > 0 && (
          <span className="text-[10px] text-red-400">-{summary.deletions}</span>
        )}
        {!expanded && summary.signals.length > 0 && (
          <span
            className={cn("ml-auto rounded-full px-2 py-0.5 text-[9px] font-medium", colors.badge)}
          >
            {summary.signals.length} signal{summary.signals.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          {topTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {topTypes.map(([ext, count]) => (
                <span
                  key={ext}
                  className="rounded bg-bg-primary px-1.5 py-0.5 text-[9px] text-text-muted"
                >
                  {ext} <span className="font-medium text-text-secondary">{count}</span>
                </span>
              ))}
              {typeCount > 5 && (
                <span className="rounded bg-bg-primary px-1.5 py-0.5 text-[9px] text-text-muted">
                  +{typeCount - 5} more
                </span>
              )}
            </div>
          )}

          {summary.signals.length > 0 ? (
            <div className="space-y-1">
              {summary.signals.map((signal) => {
                const style = SIGNAL_STYLES[signal.type];
                const Icon = style.icon;
                return (
                  <div
                    key={signal.label}
                    className={cn("flex items-start gap-2 rounded px-2 py-1", style.bg)}
                  >
                    <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", style.color)} />
                    <div className="min-w-0">
                      <span className={cn("text-[10px] font-medium", style.color)}>
                        {signal.label}
                      </span>
                      {signal.detail && (
                        <p className="truncate text-[9px] text-text-muted">{signal.detail}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-green-400">No risk signals detected</p>
          )}
        </div>
      )}
    </div>
  );
}

export function DiffSection({ overridePath }: { overridePath?: string } = {}) {
  const { projectId } = useProjectContext();
  const [diffMode, setDiffMode] = useState<DiffMode>("unstaged");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: rawDiff, isLoading, refetch } = useDiff(projectId, diffMode, overridePath);
  const { data: reviewSummary } = useReviewSummary(projectId, overridePath, diffMode === "staged");
  const { data: allComments } = useDiffComments(projectId);
  const addComment = useAddDiffComment();
  const deleteComment = useDeleteDiffComment();
  const toggleResolve = useToggleResolveDiffComment();

  // Group comments by file path
  const commentsByFile = useMemo(() => {
    if (!allComments?.length) return {};
    const map: Record<string, typeof allComments> = {};
    for (const c of allComments) {
      const arr = map[c.filePath];
      if (arr) {
        arr.push(c);
      } else {
        map[c.filePath] = [c];
      }
    }
    return map;
  }, [allComments]);

  // Track collapsed state per file (all collapsed by default)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Derive parsed files from raw diff (Rule 1: derive, don't sync)
  const parsedFiles = useMemo<DiffFile[]>(
    () => (rawDiff !== undefined ? parseUnifiedDiff(rawDiff ?? "") : []),
    [rawDiff],
  );

  // Reset expanded state when diff changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: rawDiff is intentional — reset on new diff data
  useEffect(() => {
    setExpandedFiles(new Set());
  }, [rawDiff]);

  const allExpanded =
    parsedFiles.length > 0 && parsedFiles.every((f) => expandedFiles.has(f.newPath));
  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(parsedFiles.map((f) => f.newPath)));
    }
  }, [allExpanded, parsedFiles]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<GitCompare className="h-8 w-8 text-text-muted" />}
          title="No project selected"
          description="Select a project to view diffs."
        />
      </div>
    );
  }

  const totalAdditions = parsedFiles.reduce(
    (sum, f) =>
      sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "addition").length, 0),
    0,
  );
  const totalDeletions = parsedFiles.reduce(
    (sum, f) =>
      sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "deletion").length, 0),
    0,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        {/* Diff mode toggle */}
        <div className="flex rounded bg-bg-primary">
          <button
            type="button"
            onClick={() => setDiffMode("unstaged")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-l transition-colors",
              diffMode === "unstaged"
                ? "bg-accent text-white"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            Unstaged
          </button>
          <button
            type="button"
            onClick={() => setDiffMode("staged")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-r transition-colors",
              diffMode === "staged"
                ? "bg-accent text-white"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            Staged
          </button>
        </div>

        {/* Stats */}
        {parsedFiles.length > 0 && (
          <span className="text-[11px] text-text-muted">
            {parsedFiles.length} file{parsedFiles.length !== 1 ? "s" : ""}
            {totalAdditions > 0 && <span className="ml-1 text-green-400">+{totalAdditions}</span>}
            {totalDeletions > 0 && <span className="ml-1 text-red-400">-{totalDeletions}</span>}
          </span>
        )}

        <div className="flex-1" />

        {/* Expand/Collapse All */}
        {parsedFiles.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            title={allExpanded ? "Collapse all files" : "Expand all files"}
            className="rounded p-1 text-text-muted hover:bg-bg-primary hover:text-text-primary"
          >
            {allExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* View mode toggle */}
        <button
          type="button"
          onClick={() => setViewMode(viewMode === "unified" ? "split" : "unified")}
          title={viewMode === "unified" ? "Switch to split view" : "Switch to unified view"}
          className="rounded p-1 text-text-muted hover:bg-bg-primary hover:text-text-primary"
        >
          {viewMode === "unified" ? (
            <Columns className="h-3.5 w-3.5" />
          ) : (
            <Rows className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Auto-refresh toggle */}
        <button
          type="button"
          onClick={() => setAutoRefresh(!autoRefresh)}
          title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh (5s)"}
          className={cn(
            "rounded px-2 py-1 text-[10px] font-medium transition-colors",
            autoRefresh ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary",
          )}
        >
          AUTO
        </button>

        {/* Refresh button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
          className="h-6 w-6 p-0"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && parsedFiles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          </div>
        ) : parsedFiles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<GitCompare className="h-8 w-8 text-text-muted" />}
              title="No changes"
              description={
                diffMode === "unstaged"
                  ? "Working tree is clean — no unstaged changes."
                  : "No staged changes to show."
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {reviewSummary && reviewSummary.totalFiles > 0 && (
              <ReviewSummaryBanner summary={reviewSummary} />
            )}
            {parsedFiles.map((file) => (
              <DiffFileView
                key={file.newPath}
                file={file}
                viewMode={viewMode}
                collapsed={!expandedFiles.has(file.newPath)}
                onToggle={() => toggleFile(file.newPath)}
                comments={commentsByFile[file.newPath]}
                onAddComment={
                  projectId
                    ? (lineNumber, content) =>
                        addComment.mutate({
                          projectId,
                          filePath: file.newPath,
                          lineNumber,
                          content,
                        })
                    : undefined
                }
                onDeleteComment={(id) => deleteComment.mutate(id)}
                onToggleResolve={(id) => toggleResolve.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
