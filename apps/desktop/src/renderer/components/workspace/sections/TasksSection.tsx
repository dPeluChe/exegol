import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import {
  useFileContent,
  useGitHubIssues,
  usePickFile,
  useUpdateIssueLabels,
  useUpdateIssueState,
  useWriteFile,
} from "../../../hooks/use-trpc";
import { mapIssuesToTasks } from "../../../lib/github-tasks";
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
import { TaskColumn as TaskColumnComponent } from "./tasks/TaskColumn";
import { TaskDetailModal } from "./tasks/TaskDetailModal";
import { TasksEmptyState } from "./tasks/TasksEmptyState";
import { type TaskFilter, TasksToolbar } from "./tasks/TasksToolbar";
import { archiveCompletedTasks, createTodoFile } from "./tasks/task-file-actions";
import { usePersistedTaskFile } from "./tasks/use-persisted-task-file";

// ─── Main Section ───────────────────────────────────────────────────────────

const ACTIVE_COLUMNS: Set<TaskColumn> = new Set(["backlog", "todo", "in-progress", "validated"]);
const DONE_COLUMNS: Set<TaskColumn> = new Set(["done", "archived"]);

export function TasksSection() {
  const { project } = useProjectContext();
  const [filePath, setFilePath] = usePersistedTaskFile(project?.id);
  const [autoDetectDone, setAutoDetectDone] = useState(false);
  const [addingToColumn, setAddingToColumn] = useState<TaskColumn | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [showGitHubIssues, setShowGitHubIssues] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const probeRan = useRef(false);
  const { data: fileData, refetch } = useFileContent(filePath);
  const pickFile = usePickFile();
  const writeFile = useWriteFile();

  // GitHub integration
  const hasGitRemote = !!project?.gitRemote;
  const { data: ghIssues } = useGitHubIssues(
    showGitHubIssues && hasGitRemote ? (project?.id ?? null) : null,
  );
  const updateIssueState = useUpdateIssueState();
  const updateIssueLabels = useUpdateIssueLabels();

  const board: TaskBoard | null =
    fileData && filePath ? parseTaskBoard(fileData.content, filePath) : null;

  // Compute display columns early (needed by handleToggle)
  const displayColumns = (() => {
    const core: TaskColumn[] = ["backlog", "todo", "in-progress", "validated", "done"];
    if (!board) return core;
    const extra = board.columnOrder.filter((c) => !core.includes(c));
    return [...core, ...extra];
  })();

  // Merge GitHub tasks into board columns
  const mergedColumns = useMemo(() => {
    const base: Record<TaskColumn, TaskItem[]> = {
      backlog: [],
      todo: [],
      "in-progress": [],
      validated: [],
      archived: [],
      done: [],
    };
    // Copy markdown tasks
    if (board) {
      for (const col of displayColumns) {
        base[col] = [...(board.columns[col] ?? [])];
      }
    }
    // Append GitHub tasks
    if (showGitHubIssues && ghIssues) {
      const ghTasks = mapIssuesToTasks(ghIssues);
      for (const task of ghTasks) {
        if (base[task.column]) {
          base[task.column].push(task);
        }
      }
    }
    return base;
  }, [board, displayColumns, showGitHubIssues, ghIssues]);

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
      // GitHub issue: close/reopen
      if (task.source === "github" && task.issueNumber && project?.id) {
        const newState = task.completed ? "open" : "closed";
        updateIssueState.mutate({
          projectId: project.id,
          issueNumber: task.issueNumber,
          state: newState,
        });
        return;
      }
      if (!fileData) return;
      // Toggle = advance to next column in the flow
      const colIndex = displayColumns.indexOf(task.column);
      const nextCol = displayColumns[colIndex + 1];
      if (nextCol && !task.completed) {
        // Move forward: backlog→todo→in-progress→validated→done
        writeAndRefresh(moveTask(fileData.content, task.line, nextCol));
      } else if (task.completed) {
        // If already completed, uncheck and move back to previous column
        const prevCol = displayColumns[colIndex - 1];
        if (prevCol) {
          writeAndRefresh(moveTask(fileData.content, task.line, prevCol));
        } else {
          writeAndRefresh(toggleTask(fileData.content, task.line));
        }
      } else {
        // Last column — just toggle the checkbox
        writeAndRefresh(toggleTask(fileData.content, task.line));
      }
    },
    [fileData, writeAndRefresh, displayColumns, project, updateIssueState],
  );

  const handleMove = useCallback(
    (task: TaskItem, target: TaskColumn) => {
      // GitHub issue: update state + labels for column transition
      if (task.source === "github" && task.issueNumber && project?.id) {
        const isDone = target === "done" || target === "archived";
        const isInProgress = target === "in-progress";
        // Close or reopen based on target column
        updateIssueState.mutate({
          projectId: project.id,
          issueNumber: task.issueNumber,
          state: isDone ? "closed" : "open",
        });
        // Manage "in progress" label
        if (isInProgress) {
          updateIssueLabels.mutate({
            projectId: project.id,
            issueNumber: task.issueNumber,
            addLabels: ["in progress"],
          });
        } else {
          // Remove WIP labels when moving out of in-progress
          const wipLabels = (task.tags ?? []).filter(
            (l) => l.toLowerCase() === "in progress" || l.toLowerCase() === "wip",
          );
          if (wipLabels.length > 0) {
            updateIssueLabels.mutate({
              projectId: project.id,
              issueNumber: task.issueNumber,
              removeLabels: wipLabels,
            });
          }
        }
        return;
      }
      if (!fileData) return;
      writeAndRefresh(moveTask(fileData.content, task.line, target));
    },
    [fileData, writeAndRefresh, project, updateIssueState, updateIssueLabels],
  );

  const handleRemove = useCallback(
    (task: TaskItem) => {
      // Cannot remove GitHub issues from the board
      if (task.source === "github") return;
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

  const handleArchiveCompleted = useCallback(async () => {
    if (!fileData || !filePath || !project) return;
    const newContent = await archiveCompletedTasks({
      content: fileData.content,
      filePath,
      projectPath: project.path,
      writeFile,
    });
    if (newContent !== null) {
      await writeAndRefresh(newContent);
    }
  }, [fileData, filePath, project, writeFile, writeAndRefresh]);

  const handleCreateTodo = useCallback(async () => {
    if (!project) return;
    const todoPath = await createTodoFile({
      projectName: project.name,
      projectPath: project.path,
      writeFile,
    });
    setFilePath(todoPath);
  }, [project, writeFile, setFilePath]);

  const handleDropTask = useCallback(
    (taskLine: number, _fromColumn: TaskColumn, toColumn: TaskColumn) => {
      if (!fileData) return;
      writeAndRefresh(moveTask(fileData.content, taskLine, toColumn));
    },
    [fileData, writeAndRefresh],
  );

  // ─── Empty state ──────────────────────────────────────────────────────
  if (!filePath || !fileData) {
    return <TasksEmptyState onCreateTodo={handleCreateTodo} onPickFile={handlePickFile} />;
  }

  if (!board) return null;

  // Filter visible columns
  const visibleColumns =
    filter === "all"
      ? displayColumns
      : displayColumns.filter((c) =>
          filter === "active" ? ACTIVE_COLUMNS.has(c) : DONE_COLUMNS.has(c),
        );

  const totalTasks = Object.values(mergedColumns).flat().length;
  const doneTasks = mergedColumns.done.length + mergedColumns.archived.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <TasksToolbar
        filePath={filePath}
        filter={filter}
        onFilterChange={setFilter}
        displayColumns={displayColumns}
        mergedColumns={mergedColumns}
        totalTasks={totalTasks}
        progress={progress}
        doneTasks={doneTasks}
        hasGitRemote={hasGitRemote}
        showGitHubIssues={showGitHubIssues}
        onToggleGitHubIssues={() => setShowGitHubIssues(!showGitHubIssues)}
        onArchiveCompleted={handleArchiveCompleted}
        onPickFile={handlePickFile}
      />

      {/* Kanban board */}
      <div className="flex flex-1 gap-2 overflow-x-auto p-2">
        {visibleColumns.map((col, idx) => (
          <TaskColumnComponent
            key={col}
            column={col}
            tasks={mergedColumns[col]}
            allColumns={displayColumns}
            columnIndex={idx}
            onToggle={handleToggle}
            onMove={handleMove}
            onRemove={handleRemove}
            onAdd={(c) => setAddingToColumn(c)}
            onDropTask={handleDropTask}
            onOpenTask={(t) => setSelectedTask(t)}
            isAdding={addingToColumn === col}
            onAddSubmit={(text, tags) => handleAdd(text, tags, col)}
            onAddCancel={() => setAddingToColumn(null)}
          />
        ))}
      </div>

      {/* Inline add task */}
      {/* Inline add now renders inside the Column component */}

      {/* Task detail modal */}
      {selectedTask && filePath && (
        <TaskDetailModal
          task={selectedTask}
          filePath={filePath}
          columns={displayColumns}
          onMove={(target) => handleMove(selectedTask, target)}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
