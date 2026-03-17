import { Button, cn } from "@exegol/ui";
import { Columns, GitCompare, Loader2, RefreshCw, Rows } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useDiff } from "../../../hooks/use-trpc";
import { EmptyState } from "../../common/EmptyState";
import { DiffFileView } from "./diff/DiffFileView";
import { type DiffFile, parseUnifiedDiff } from "./diff/diff-parser";

type DiffMode = "unstaged" | "staged";
type ViewMode = "unified" | "split";

export function DiffSection() {
  const { projectId } = useProjectContext();
  const [diffMode, setDiffMode] = useState<DiffMode>("unstaged");
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<DiffFile[]>([]);

  const { data: rawDiff, isLoading, refetch } = useDiff(projectId, diffMode);

  // Parse diff when raw data changes
  useEffect(() => {
    if (rawDiff !== undefined) {
      setParsedFiles(parseUnifiedDiff(rawDiff ?? ""));
    }
  }, [rawDiff]);

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
            {parsedFiles.map((file) => (
              <DiffFileView key={file.newPath} file={file} viewMode={viewMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
