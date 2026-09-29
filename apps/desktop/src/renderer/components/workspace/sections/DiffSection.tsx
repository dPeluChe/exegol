import { cn } from "@exegol/ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitCompare,
  Info,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  type ReviewSignal,
  type ReviewSummary,
  useDiff,
  useReviewSummary,
} from "../../../hooks/use-trpc";
import { EmptyState } from "../../common/EmptyState";
import { DiffFileView } from "./diff/DiffFileView";
import { DiffToolbar } from "./diff/DiffToolbar";
import { type DiffFile, type DiffMode, parseUnifiedDiff, type ViewMode } from "./diff/diff-parser";
import { useExpandedDiffFiles } from "./diff/use-expanded-diff-files";

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

  const {
    data: rawDiff,
    isLoading,
    refetch,
  } = useDiff(projectId, diffMode, overridePath, autoRefresh ? 5000 : undefined);
  const { data: reviewSummary } = useReviewSummary(projectId, overridePath, diffMode === "staged");

  // Derive parsed files from raw diff (Rule 1: derive, don't sync)
  const parsedFiles = useMemo<DiffFile[]>(
    () => (rawDiff !== undefined ? parseUnifiedDiff(rawDiff ?? "") : []),
    [rawDiff],
  );
  const { expandedFiles, allExpanded, toggleAll, toggleFile } = useExpandedDiffFiles(
    rawDiff,
    parsedFiles,
  );

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

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        parsedFiles={parsedFiles}
        diffMode={diffMode}
        onDiffModeChange={setDiffMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        allExpanded={allExpanded}
        onToggleAll={toggleAll}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />

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
                projectId={projectId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
