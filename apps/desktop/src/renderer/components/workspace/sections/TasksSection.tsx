import { Button, ScrollArea } from "@exegol/ui";
import { CheckSquare, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useFileContent, usePickFile, useWriteFile } from "../../../hooks/use-trpc";
import { parseMarkdownTasks, type TaskItem, toggleTask } from "../../../lib/markdown-tasks";
import { EmptyState } from "../../common/EmptyState";

export function TasksSection() {
  const { project } = useProjectContext();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [autoDetectFailed, setAutoDetectFailed] = useState(false);
  const { data: fileData, error: fileError, refetch } = useFileContent(filePath);
  const pickFile = usePickFile();
  const writeFile = useWriteFile();

  const tasks = fileData ? parseMarkdownTasks(fileData.content) : [];
  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Try to auto-detect a task file in the project root
  useEffect(() => {
    if (!project || filePath || autoDetectFailed) return;
    setFilePath(`${project.path}/TODO.md`);
  }, [project, filePath, autoDetectFailed]);

  // If auto-detected file doesn't exist, reset to clean empty state
  useEffect(() => {
    if (fileError && filePath && !autoDetectFailed) {
      setFilePath(null);
      setAutoDetectFailed(true);
    }
  }, [fileError, filePath, autoDetectFailed]);

  const handlePickFile = useCallback(async () => {
    if (!project) return;
    const selected = await pickFile.mutateAsync({ projectPath: project.path });
    if (selected) setFilePath(selected);
  }, [project, pickFile]);

  const handleToggle = useCallback(
    async (task: TaskItem) => {
      if (!filePath || !fileData) return;
      const updated = toggleTask(fileData.content, task.line);
      await writeFile.mutateAsync({ path: filePath, content: updated });
      refetch();
    },
    [filePath, fileData, writeFile, refetch],
  );

  if (!filePath || !fileData) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <EmptyState
          icon={<CheckSquare className="h-8 w-8 text-text-muted" />}
          title="No task file loaded"
          description="Open a markdown file to track tasks."
          action={{ label: "Open File", onClick: handlePickFile }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary px-3">
        <span className="truncate text-xs text-text-muted" title={filePath}>
          {filePath}
        </span>
        <Button
          type="button"
          onClick={handlePickFile}
          className="ml-auto h-7 gap-1.5 bg-bg-tertiary px-2 text-[11px] text-text-secondary hover:text-text-primary"
        >
          <FolderOpen className="h-3 w-3" />
          Open File
        </Button>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-text-muted">
            {completedCount}/{totalCount} ({progressPercent}%)
          </span>
        </div>
      )}

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-3">
          {tasks.map((task) => (
            <label
              key={task.id}
              htmlFor={`task-${task.id}`}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-white/5"
              style={{ paddingLeft: `${task.depth * 20 + 8}px` }}
            >
              <input
                id={`task-${task.id}`}
                type="checkbox"
                checked={task.completed}
                onChange={() => handleToggle(task)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border accent-[var(--accent)]"
              />
              <span
                className={`text-xs ${task.completed ? "text-text-muted line-through" : "text-text-primary"}`}
              >
                {task.text}
              </span>
            </label>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
