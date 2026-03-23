import { cn } from "@exegol/ui";
import { useState } from "react";
import type { TaskColumn, TaskItem } from "../../../../lib/markdown-tasks";
import { COLUMN_CONFIG } from "./config";

export function TaskDetailModal({
  task,
  filePath,
  onClose,
  onMove,
  columns,
}: {
  task: TaskItem;
  filePath: string;
  onClose: () => void;
  onMove: (target: TaskColumn) => void;
  columns: TaskColumn[];
}) {
  const [copied, setCopied] = useState(false);

  // Build prompt text for agent assignment
  const promptText = [
    `Task: ${task.text}`,
    task.tags.length > 0 ? `Tags: ${task.tags.map((t) => `#${t}`).join(" ")}` : "",
    task.priority ? `Priority: ${task.priority}` : "",
    `Source: ${filePath}:${task.line + 1}`,
    `Status: ${COLUMN_CONFIG[task.column].label}`,
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const otherColumns = columns.filter((c) => c !== task.column);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop dismiss
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: handled by backdrop */}
      <div
        className="w-full max-w-md rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                COLUMN_CONFIG[task.column].color.replace("text-", "bg-"),
              )}
            />
            <span className="text-[10px] font-medium text-text-muted">
              {COLUMN_CONFIG[task.column].label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Task title */}
        <h3 className="mb-2 text-sm font-semibold text-text-primary">{task.text}</h3>

        {/* Metadata */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-accent/10 px-2 py-0.5 text-[9px] font-medium text-accent"
            >
              #{tag}
            </span>
          ))}
          {task.assignedAgent && (
            <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[9px] font-medium text-purple-400">
              @{task.assignedAgent}
            </span>
          )}
          {task.priority && (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-[9px] font-medium",
                task.priority === "high" && "bg-red-500/10 text-red-400",
                task.priority === "medium" && "bg-yellow-500/10 text-yellow-400",
                task.priority === "low" && "bg-blue-500/10 text-blue-400",
              )}
            >
              !{task.priority}
            </span>
          )}
        </div>

        {/* Source file */}
        <div className="mb-3 rounded-lg bg-bg-tertiary px-3 py-2">
          <p className="text-[9px] text-text-muted">Source</p>
          <p className="truncate text-[10px] text-text-secondary">
            {filePath.split("/").slice(-2).join("/")}:{task.line + 1}
          </p>
        </div>

        {/* Agent prompt preview */}
        <div className="mb-3 rounded-lg border border-border bg-bg-primary p-3">
          <p className="mb-1 text-[9px] font-medium text-text-muted">Agent Prompt</p>
          <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-text-secondary">
            {promptText}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "flex-1 rounded-lg py-2 text-center text-xs font-medium transition-all",
              copied
                ? "bg-green-500/20 text-green-400"
                : "bg-accent/15 text-accent hover:bg-accent/25",
            )}
          >
            {copied ? "Copied ✓" : "Copy for Agent"}
          </button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("exegol:switch-section", {
                  detail: { section: "pipelines" },
                }),
              );
              onClose();
            }}
            className="rounded-lg bg-purple-500/15 px-3 py-2 text-xs font-medium text-purple-400 hover:bg-purple-500/25"
          >
            Run Pipeline
          </button>
          {otherColumns.length > 0 && (
            <div className="flex items-center gap-1">
              {otherColumns.slice(0, 3).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => {
                    onMove(col);
                    onClose();
                  }}
                  className="rounded-lg bg-white/5 px-2 py-2 text-[9px] text-text-muted hover:bg-white/10 hover:text-text-primary"
                >
                  → {COLUMN_CONFIG[col].label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
