import { cn, ScrollArea } from "@exegol/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { TaskColumn as TaskColumnType, TaskItem } from "../../../../lib/markdown-tasks";
import { AddTaskInline } from "./AddTaskInline";
import { COLUMN_CONFIG } from "./config";
import { TaskCard } from "./TaskCard";

export function TaskColumn({
  column,
  tasks,
  allColumns,
  columnIndex,
  onToggle,
  onMove,
  onRemove,
  onAdd,
  onDropTask,
  onOpenTask,
  isAdding,
  onAddSubmit,
  onAddCancel,
}: {
  column: TaskColumnType;
  tasks: TaskItem[];
  allColumns: TaskColumnType[];
  columnIndex: number;
  onToggle: (task: TaskItem) => void;
  onMove: (task: TaskItem, target: TaskColumnType) => void;
  onRemove: (task: TaskItem) => void;
  onAdd: (column: TaskColumnType) => void;
  onDropTask: (taskLine: number, fromColumn: TaskColumnType, toColumn: TaskColumnType) => void;
  onOpenTask: (task: TaskItem) => void;
  isAdding: boolean;
  onAddSubmit: (text: string, tags: string[]) => void;
  onAddCancel: () => void;
}) {
  const cfg = COLUMN_CONFIG[column];
  const Icon = cfg.icon;
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Next/prev columns for quick-move arrows
  const prevCol = columnIndex > 0 ? allColumns[columnIndex - 1] : undefined;
  const nextCol = columnIndex < allColumns.length - 1 ? allColumns[columnIndex + 1] : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop column target
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-bg-secondary transition-all",
        collapsed ? "w-10 min-w-10" : "min-w-[220px] flex-1",
        dragOver ? "border-accent/60 bg-accent/5" : "border-border/50",
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/exegol-task")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData("application/exegol-task");
        if (!raw) return;
        try {
          const { line, column: fromCol } = JSON.parse(raw) as {
            line: number;
            column: TaskColumnType;
          };
          if (fromCol !== column) {
            onDropTask(line, fromCol, column);
          }
        } catch {
          /* invalid data */
        }
      }}
    >
      {/* Column header — click to collapse */}
      <div className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-2 py-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2"
        >
          <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
          {!collapsed && (
            <>
              <span className="text-xs font-semibold text-text-primary">{cfg.label}</span>
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] tabular-nums text-text-muted">
                {tasks.length}
              </span>
            </>
          )}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => onAdd(column)}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
            title={`Add task to ${cfg.label}`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Collapsed: vertical count */}
      {collapsed && tasks.length > 0 && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[9px] font-medium text-text-muted [writing-mode:vertical-lr]">
            {cfg.label} ({tasks.length})
          </span>
        </div>
      )}

      {/* Cards */}
      {!collapsed && (
        <ScrollArea className="flex-1">
          <div className="space-y-1.5 p-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={() => onToggle(task)}
                onMove={(target) => onMove(task, target)}
                onRemove={() => onRemove(task)}
                onOpen={() => onOpenTask(task)}
                columns={allColumns}
                prevColumn={prevCol}
                nextColumn={nextCol}
              />
            ))}
            {tasks.length === 0 && !isAdding && (
              <p className="py-4 text-center text-[10px] italic text-text-muted">No tasks</p>
            )}
            {isAdding && <AddTaskInline onAdd={onAddSubmit} onCancel={onAddCancel} />}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
