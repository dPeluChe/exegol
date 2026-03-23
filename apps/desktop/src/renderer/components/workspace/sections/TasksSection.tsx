import { Button, cn } from "@exegol/ui";
import { Archive, CheckSquare, FolderOpen, Github, Plus } from "lucide-react";
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
import { EmptyState } from "../../common/EmptyState";
import { COLUMN_CONFIG } from "./tasks/config";
import { TaskColumn as TaskColumnComponent } from "./tasks/TaskColumn";
import { TaskDetailModal } from "./tasks/TaskDetailModal";

// ─── Hook: persist task file path per project ────────────────────────────────

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

// ─── Main Section ───────────────────────────────────────────────────────────

export function TasksSection() {
  const { project } = useProjectContext();
  const [filePath, setFilePath] = usePersistedTaskFile(project?.id);
  const [autoDetectDone, setAutoDetectDone] = useState(false);
  const [addingToColumn, setAddingToColumn] = useState<TaskColumn | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [showGitHubIssues, setShowGitHubIssues] = useState(false);
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
    const parsedBoard = parseTaskBoard(fileData.content, filePath);
    const allTasks = Object.values(parsedBoard.columns).flat();
    const completed = allTasks.filter((t) => t.completed);
    if (completed.length === 0) return;

    const date = new Date().toISOString().split("T")[0];
    const archiveLines = completed.map((t) => `- [x] ${t.text}`).join("\n");
    const archiveEntry = `\n## Archived ${date}\n${archiveLines}\n`;

    const archivePath = `${project.path}/docs/tasks_completed.md`;
    try {
      const existing = await trpcInvoke<{ content: string }>("files.readFile", {
        path: archivePath,
      });
      await writeFile.mutateAsync({
        path: archivePath,
        content: `${existing.content}${archiveEntry}`,
      });
    } catch {
      await writeFile.mutateAsync({
        path: archivePath,
        content: `# Completed Tasks\n${archiveEntry}`,
      });
    }

    const content = fileData.content;
    const sortedLines = completed.map((t) => t.line).sort((a, b) => b - a);
    const lines = content.split("\n");
    for (const line of sortedLines) {
      lines.splice(line, 1);
    }
    await writeAndRefresh(lines.join("\n"));
  }, [fileData, filePath, project, writeFile, writeAndRefresh]);

  const handleCreateTodo = useCallback(async () => {
    if (!project) return;
    const todoPath = `${project.path}/docs/TODO.md`;
    const template = `# ${project.name} — Task Board

## Backlog
- [ ] Define project requirements
- [ ] Setup development environment

## Todo

## In Progress

## Validated

## Done

---
> Managed by Exegol. Move tasks between sections to update status.
> Tags: #feature #bug #refactor #docs | Priority: !high !medium !low | Agent: @claude-code
`;
    // Ensure docs/ directory exists
    try {
      await trpcInvoke("files.writeFile", { path: `${project.path}/docs/.gitkeep`, content: "" });
    } catch {
      /* dir may already exist */
    }
    await writeFile.mutateAsync({ path: todoPath, content: template });
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
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <EmptyState
          icon={<CheckSquare className="h-8 w-8 text-text-muted" />}
          title="No task file found"
          description="Create a TODO.md or open an existing one"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleCreateTodo}
            className="gap-1.5 bg-accent text-white hover:bg-accent/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Create TODO.md
          </Button>
          <Button
            type="button"
            onClick={handlePickFile}
            className="gap-1.5 bg-bg-tertiary text-text-secondary hover:text-text-primary"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Existing
          </Button>
        </div>
      </div>
    );
  }

  if (!board) return null;

  // displayColumns computed above (before guards, for handleToggle access)

  const totalTasks = Object.values(mergedColumns).flat().length;
  const doneTasks = mergedColumns.done.length + mergedColumns.archived.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary px-3">
        <span className="truncate text-[10px] text-text-muted" title={filePath}>
          {filePath.split("/").pop()}
        </span>
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
            onClick={() => setShowGitHubIssues(!showGitHubIssues)}
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
            onClick={handleArchiveCompleted}
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
          onClick={handlePickFile}
          className={cn(
            !hasGitRemote && doneTasks === 0 && "ml-auto",
            "h-6 gap-1 bg-bg-tertiary px-2 text-[10px] text-text-secondary hover:text-text-primary",
          )}
        >
          <FolderOpen className="h-3 w-3" />
          Open
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 gap-2 overflow-x-auto p-2">
        {displayColumns.map((col, idx) => (
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
