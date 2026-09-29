import { Button, cn } from "@exegol/ui";
import { ChevronsDownUp, ChevronsUpDown, Columns, Loader2, RefreshCw, Rows } from "lucide-react";
import type { DiffFile, DiffLine, DiffMode, ViewMode } from "./diff-parser";

function countLines(files: DiffFile[], type: DiffLine["type"]): number {
  return files.reduce(
    (sum, f) =>
      sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === type).length, 0),
    0,
  );
}

export function DiffToolbar({
  parsedFiles,
  diffMode,
  onDiffModeChange,
  viewMode,
  onViewModeChange,
  autoRefresh,
  onAutoRefreshChange,
  allExpanded,
  onToggleAll,
  isLoading,
  onRefresh,
}: {
  parsedFiles: DiffFile[];
  diffMode: DiffMode;
  onDiffModeChange: (mode: DiffMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (on: boolean) => void;
  allExpanded: boolean;
  onToggleAll: () => void;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const totalAdditions = countLines(parsedFiles, "addition");
  const totalDeletions = countLines(parsedFiles, "deletion");

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
      {/* Diff mode toggle */}
      <div className="flex rounded bg-bg-primary">
        <button
          type="button"
          onClick={() => onDiffModeChange("unstaged")}
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
          onClick={() => onDiffModeChange("staged")}
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
          onClick={onToggleAll}
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
        onClick={() => onViewModeChange(viewMode === "unified" ? "split" : "unified")}
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
        onClick={() => onAutoRefreshChange(!autoRefresh)}
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
        onClick={onRefresh}
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
  );
}
