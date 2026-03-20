import { Button, cn, ScrollArea } from "@exegol/ui";
import { ArrowRight, CheckSquare, Circle, FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { useFileContent, usePickFile, useWriteFile } from "../../../hooks/use-trpc";
import {
  addTask,
  moveTask,
  parseTaskBoard,
  removeTask,
  type TaskBoard,
  type TaskColumn,
  type TaskItem,
  toggleTask,
} from "../../../lib/markdown-tasks";
import { trpcInvoke } from "../../../lib/trpc-client";
import { EmptyState } from "../../common/EmptyState";

// ─── Column config ──────────────────────────────────────────────────────────

const COLUMN_CONFIG: Record<TaskColumn, { label: string; color: string; icon: typeof Circle }> = {
  backlog: { label: "Backlog", color: "text-zinc-400", icon: Circle },
  todo: { label: "Todo", color: "text-blue-400", icon: Circle },
  "in-progress": { label: "In Progress", color: "text-yellow-400", icon: Loader2 },
  validated: { label: "Validated", color: "text-purple-400", icon: CheckSquare },
  archived: { label: "Archived", color: "text-zinc-500", icon: Circle },
  done: { label: "Done", color: "text-green-400", icon: CheckSquare },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onToggle,
  onMove,
  onRemove,
  columns,
}: {
  task: TaskItem;
  onToggle: () => void;
  onMove: (target: TaskColumn) => void;
  onRemove: () => void;
  columns: TaskColumn[];
}) {
  const [showActions, setShowActions] = useState(false);
  const nextColumns = columns.filter((c) => c !== task.column);

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border bg-bg-primary p-2.5 transition-all hover:border-border/80 hover:shadow-sm",
        task.priority && `border-l-2 ${PRIORITY_COLORS[task.priority]}`,
      )}
    >
      {/* Task text + toggle */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            task.completed
              ? "border-green-500 bg-green-500/20 text-green-400"
              : "border-border text-transparent hover:border-accent hover:text-accent",
          )}
        >
          {task.completed && <CheckSquare className="h-3 w-3" />}
        </button>
        <span
          className={cn(
            "flex-1 text-xs leading-relaxed",
            task.completed ? "text-text-muted line-through" : "text-text-primary",
          )}
        >
          {task.text}
        </span>
      </div>

      {/* Tags + agent */}
      {(task.tags.length > 0 || task.assignedAgent) && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-accent/10 px-1.5 py-0.5 text-[8px] font-medium text-accent"
            >
              #{tag}
            </span>
          ))}
          {task.assignedAgent && (
            <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[8px] font-medium text-purple-400">
              @{task.assignedAgent}
            </span>
          )}
          {task.priority && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[8px] font-medium",
                task.priority === "high" && "bg-red-500/10 text-red-400",
                task.priority === "medium" && "bg-yellow-500/10 text-yellow-400",
                task.priority === "low" && "bg-blue-500/10 text-blue-400",
              )}
            >
              !{task.priority}
            </span>
          )}
        </div>
      )}

      {/* Hover actions */}
      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {nextColumns.length > 0 && (
          <button
            type="button"
            onClick={() => setShowActions(!showActions)}
            className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-text-muted hover:bg-white/10 hover:text-text-primary"
            title="Move to..."
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded bg-bg-secondary text-text-muted hover:bg-red-500/10 hover:text-red-400"
          title="Remove task"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Move menu */}
      {showActions && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border/50 pt-1.5">
          {nextColumns.map((col) => {
            const cfg = COLUMN_CONFIG[col];
            return (
              <button
                key={col}
                type="button"
                onClick={() => {
                  onMove(col);
                  setShowActions(false);
                }}
                className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] text-text-muted hover:bg-white/10 hover:text-text-primary"
              >
                → {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Column ─────────────────────────────────────────────────────────────────

function Column({
  column,
  tasks,
  allColumns,
  onToggle,
  onMove,
  onRemove,
  onAdd,
}: {
  column: TaskColumn;
  tasks: TaskItem[];
  allColumns: TaskColumn[];
  onToggle: (task: TaskItem) => void;
  onMove: (task: TaskItem, target: TaskColumn) => void;
  onRemove: (task: TaskItem) => void;
  onAdd: (column: TaskColumn) => void;
}) {
  const cfg = COLUMN_CONFIG[column];
  const Icon = cfg.icon;

  return (
    <div className="flex min-w-[220px] flex-1 flex-col rounded-xl border border-border/50 bg-bg-secondary">
      {/* Column header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
        <span className="text-xs font-semibold text-text-primary">{cfg.label}</span>
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] tabular-nums text-text-muted">
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={() => onAdd(column)}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title={`Add task to ${cfg.label}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Cards */}
      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => onToggle(task)}
              onMove={(target) => onMove(task, target)}
              onRemove={() => onRemove(task)}
              columns={allColumns}
            />
          ))}
          {tasks.length === 0 && (
            <p className="py-4 text-center text-[10px] italic text-text-muted">No tasks</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Add Task Dialog ────────────────────────────────────────────────────────

function AddTaskInline({
  onAdd,
  onCancel,
}: {
  onAdd: (text: string, tags: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useMountEffect(() => {
    inputRef.current?.focus();
  });

  const handleSubmit = () => {
    if (!text.trim()) return;
    // Extract inline tags
    const tags: string[] = [];
    const cleaned = text.replace(/#([\w-]+)/g, (_, tag) => {
      tags.push(tag);
      return "";
    });
    onAdd(cleaned.trim(), tags);
    setText("");
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-accent/30 bg-bg-primary p-1.5">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task description #tag"
        className="flex-1 bg-transparent text-[10px] text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        onClick={handleSubmit}
        className="rounded bg-accent/20 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/30"
      >
        Add
      </button>
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

/** Persist task file path per project in localStorage */
function usePersistedTaskFile(projectId: string | undefined) {
  const key = projectId ? `exegol-task-file-${projectId}` : null;
  const [filePath, setFilePathState] = useState<string | null>(() => {
    if (!key) return null;
    return localStorage.getItem(key);
  });

  const setFilePath = useCallback(
    (path: string | null) => {
      setFilePathState(path);
      if (key) {
        if (path) localStorage.setItem(key, path);
        else localStorage.removeItem(key);
      }
    },
    [key],
  );

  return [filePath, setFilePath] as const;
}

export function TasksSection() {
  const { project } = useProjectContext();
  const [filePath, setFilePath] = usePersistedTaskFile(project?.id);
  const [autoDetectDone, setAutoDetectDone] = useState(false);
  const [addingToColumn, setAddingToColumn] = useState<TaskColumn | null>(null);
  const probeRan = useRef(false);
  const { data: fileData, refetch } = useFileContent(filePath);
  const pickFile = usePickFile();
  const writeFile = useWriteFile();

  const board: TaskBoard | null =
    fileData && filePath ? parseTaskBoard(fileData.content, filePath) : null;

  // Auto-detect task files
  useMountEffect(() => {
    if (!project || filePath || autoDetectDone || probeRan.current) return;
    probeRan.current = true;
    const candidates = ["TODO.md", "todo.md", "TASKS.md", "tasks.md", "plan.md", "PLAN.md"];
    (async () => {
      for (const name of candidates) {
        const fullPath = `${project.path}/${name}`;
        const result = await trpcInvoke<{ exists: boolean }>("files.exists", { path: fullPath });
        if (result.exists) {
          setFilePath(fullPath);
          setAutoDetectDone(true);
          return;
        }
      }
      setAutoDetectDone(true);
    })();
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: setFilePath is stable from usePersistedTaskFile
  const handlePickFile = useCallback(async () => {
    if (!project) return;
    const selected = await pickFile.mutateAsync({ projectPath: project.path });
    if (selected) setFilePath(selected);
  }, [project, pickFile]);

  const writeAndRefresh = useCallback(
    async (newContent: string) => {
      if (!filePath) return;
      await writeFile.mutateAsync({ path: filePath, content: newContent });
      refetch();
    },
    [filePath, writeFile, refetch],
  );

  const handleToggle = useCallback(
    (task: TaskItem) => {
      if (!fileData) return;
      writeAndRefresh(toggleTask(fileData.content, task.line));
    },
    [fileData, writeAndRefresh],
  );

  const handleMove = useCallback(
    (task: TaskItem, target: TaskColumn) => {
      if (!fileData) return;
      writeAndRefresh(moveTask(fileData.content, task.line, target));
    },
    [fileData, writeAndRefresh],
  );

  const handleRemove = useCallback(
    (task: TaskItem) => {
      if (!fileData) return;
      writeAndRefresh(removeTask(fileData.content, task.line));
    },
    [fileData, writeAndRefresh],
  );

  const handleAdd = useCallback(
    (text: string, tags: string[], column: TaskColumn) => {
      if (!fileData) return;
      writeAndRefresh(addTask(fileData.content, text, column, tags));
      setAddingToColumn(null);
    },
    [fileData, writeAndRefresh],
  );

  // ─── Empty state ──────────────────────────────────────────────────────
  if (!filePath || !fileData) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <EmptyState
          icon={<CheckSquare className="h-8 w-8 text-text-muted" />}
          title="No task file loaded"
          description="Open a markdown file with tasks (TODO.md, TASKS.md)"
          action={{ label: "Open File", onClick: handlePickFile }}
        />
      </div>
    );
  }

  if (!board) return null;

  // Use detected columns, or defaults
  const displayColumns =
    board.columnOrder.length > 0
      ? board.columnOrder
      : (["backlog", "in-progress", "done"] as TaskColumn[]);

  const totalTasks = Object.values(board.columns).flat().length;
  const doneTasks = board.columns.done.length + board.columns.archived.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary px-3">
        <span className="truncate text-[10px] text-text-muted" title={filePath}>
          {filePath.split("/").pop()}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-20 overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-text-muted">
            {doneTasks}/{totalTasks}
          </span>
        </div>
        <Button
          type="button"
          onClick={handlePickFile}
          className="ml-auto h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary hover:text-text-primary"
        >
          <FolderOpen className="h-3 w-3" />
          Open
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 gap-2 overflow-x-auto p-2">
        {displayColumns.map((col) => (
          <Column
            key={col}
            column={col}
            tasks={board.columns[col]}
            allColumns={displayColumns}
            onToggle={handleToggle}
            onMove={handleMove}
            onRemove={handleRemove}
            onAdd={(c) => setAddingToColumn(c)}
          />
        ))}
      </div>

      {/* Inline add task */}
      {addingToColumn && (
        <div className="border-t border-border bg-bg-secondary px-3 py-2">
          <AddTaskInline
            onAdd={(text, tags) => handleAdd(text, tags, addingToColumn)}
            onCancel={() => setAddingToColumn(null)}
          />
        </div>
      )}
    </div>
  );
}
