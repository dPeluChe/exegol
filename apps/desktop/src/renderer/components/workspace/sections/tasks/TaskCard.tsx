import { cn } from "@exegol/ui";
import { ArrowRight, CheckSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TaskColumn, TaskItem } from "../../../../lib/markdown-tasks";
import { COLUMN_CONFIG, PRIORITY_COLORS } from "./config";
import { TaskBadges } from "./TaskBadges";

export function TaskCard({
  task,
  onToggle,
  onMove,
  onRemove,
  onOpen,
  columns,
  prevColumn,
  nextColumn,
}: {
  task: TaskItem;
  onToggle: () => void;
  onMove: (target: TaskColumn) => void;
  onRemove: () => void;
  onOpen: () => void;
  columns: TaskColumn[];
  prevColumn?: TaskColumn;
  nextColumn?: TaskColumn;
}) {
  const [showAllMoves, setShowAllMoves] = useState(false);
  const otherColumns = columns.filter((c) => c !== task.column);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop task card
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/exegol-task",
          JSON.stringify({ line: task.line, column: task.column }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group relative cursor-grab rounded-lg border border-border bg-bg-primary p-2.5 transition-all hover:border-border/80 hover:shadow-sm active:cursor-grabbing active:opacity-70",
        task.priority && `border-l-2 ${PRIORITY_COLORS[task.priority]}`,
      )}
    >
      {/* Task text + toggle */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            task.completed
              ? "border-green-500 bg-green-500/20 text-green-400"
              : "border-border text-transparent hover:border-accent hover:text-accent",
          )}
        >
          {task.completed && <CheckSquare className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "flex-1 text-left text-xs leading-relaxed hover:underline",
            task.completed ? "text-text-muted line-through" : "text-text-primary",
          )}
        >
          {task.source === "github" && (
            <span className="mr-1 font-mono text-[10px] text-text-muted">#{task.issueNumber}</span>
          )}
          {task.text}
        </button>
      </div>

      {/* Tags + agent */}
      {(task.tags.length > 0 || task.assignedAgent) && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
          <TaskBadges task={task} badgeClassName="rounded px-1.5 py-0.5 text-[8px] font-medium" />
        </div>
      )}

      <TaskCardQuickActions
        prevColumn={prevColumn}
        nextColumn={nextColumn}
        showMoreToggle={otherColumns.length > 2}
        canRemove={task.source !== "github"}
        onMove={onMove}
        onToggleMoreMoves={() => setShowAllMoves(!showAllMoves)}
        onRemove={onRemove}
      />

      {/* All destinations menu */}
      {showAllMoves && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border/50 pt-1.5">
          {otherColumns.map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => {
                onMove(col);
                setShowAllMoves(false);
              }}
              className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] text-text-muted hover:bg-white/10 hover:text-text-primary"
            >
              → {COLUMN_CONFIG[col].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Quick-move arrows + actions, shown on card hover. */
function TaskCardQuickActions({
  prevColumn,
  nextColumn,
  showMoreToggle,
  canRemove,
  onMove,
  onToggleMoreMoves,
  onRemove,
}: {
  prevColumn?: TaskColumn;
  nextColumn?: TaskColumn;
  showMoreToggle: boolean;
  canRemove: boolean;
  onMove: (target: TaskColumn) => void;
  onToggleMoreMoves: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      {prevColumn && (
        <button
          type="button"
          onClick={() => onMove(prevColumn)}
          className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-text-muted hover:bg-white/10 hover:text-text-primary"
          title={`Move to ${COLUMN_CONFIG[prevColumn].label}`}
        >
          <ArrowRight className="h-3 w-3 rotate-180" />
        </button>
      )}
      {nextColumn && (
        <button
          type="button"
          onClick={() => onMove(nextColumn)}
          className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-text-muted hover:bg-accent/20 hover:text-accent"
          title={`Move to ${COLUMN_CONFIG[nextColumn].label}`}
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
      {showMoreToggle && (
        <button
          type="button"
          onClick={onToggleMoreMoves}
          className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-[8px] text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="More destinations..."
        >
          •••
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-text-muted hover:bg-red-500/10 hover:text-red-400"
          title="Remove task"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
