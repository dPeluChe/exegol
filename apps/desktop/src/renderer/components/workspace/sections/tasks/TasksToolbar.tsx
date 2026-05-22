import { Button, cn } from "@exegol/ui";
import { Archive, FolderOpen, Github } from "lucide-react";
import type { TaskColumn, TaskItem } from "../../../../lib/markdown-tasks";
import { COLUMN_CONFIG } from "./config";

export const TASK_FILTERS = ["all", "active", "done"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

interface TasksToolbarProps {
  filePath: string;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  displayColumns: TaskColumn[];
  mergedColumns: Record<TaskColumn, TaskItem[]>;
  totalTasks: number;
  progress: number;
  doneTasks: number;
  hasGitRemote: boolean;
  showGitHubIssues: boolean;
  onToggleGitHubIssues: () => void;
  onArchiveCompleted: () => void;
  onPickFile: () => void;
}

export function TasksToolbar({
  filePath,
  filter,
  onFilterChange,
  displayColumns,
  mergedColumns,
  totalTasks,
  progress,
  doneTasks,
  hasGitRemote,
  showGitHubIssues,
  onToggleGitHubIssues,
  onArchiveCompleted,
  onPickFile,
}: TasksToolbarProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary px-3">
      <span className="truncate text-[10px] text-text-muted" title={filePath}>
        {filePath.split("/").pop()}
      </span>
      {/* Filter toggle */}
      <div className="flex items-center rounded-md border border-border">
        {TASK_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            className={cn(
              "px-2 py-0.5 text-[9px] font-medium capitalize transition-colors",
              filter === f
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      {/* Column counts */}
      <div className="flex items-center gap-1">
        {displayColumns.map((col) => {
          const count = mergedColumns[col].length;
          if (count === 0) return null;
          const cfg = COLUMN_CONFIG[col];
          return (
            <span
              key={col}
              className={cn("rounded px-1.5 py-0.5 text-[8px] font-medium", cfg.color)}
              title={cfg.label}
            >
              {cfg.label.slice(0, 3)} {count}
            </span>
          );
        })}
        <span className="text-[8px] text-text-muted">· {totalTasks} total</span>
      </div>
      {/* Progress bar */}
      <div className="flex items-center gap-1">
        <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[8px] tabular-nums text-text-muted">{progress}%</span>
      </div>
      {hasGitRemote && (
        <Button
          type="button"
          onClick={onToggleGitHubIssues}
          className={cn(
            "ml-auto h-6 gap-1 px-2 text-[10px]",
            showGitHubIssues
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "bg-bg-tertiary text-text-secondary hover:text-text-primary",
          )}
          title={showGitHubIssues ? "Hide GitHub Issues" : "Show GitHub Issues"}
        >
          <Github className="h-3 w-3" />
          Issues
        </Button>
      )}
      {doneTasks > 0 && (
        <Button
          type="button"
          onClick={onArchiveCompleted}
          className={cn(
            !hasGitRemote && "ml-auto",
            "h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary hover:text-text-primary",
          )}
          title="Move completed tasks to tasks_completed.md"
        >
          <Archive className="h-3 w-3" />
          Archive {doneTasks}
        </Button>
      )}
      <Button
        type="button"
        onClick={onPickFile}
        className={cn(
          !hasGitRemote && doneTasks === 0 && "ml-auto",
          "h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary hover:text-text-primary",
        )}
      >
        <FolderOpen className="h-3 w-3" />
        Open
      </Button>
    </div>
  );
}
