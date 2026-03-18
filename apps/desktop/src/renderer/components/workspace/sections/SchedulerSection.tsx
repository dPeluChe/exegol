import type { ScheduledResult, ScheduledTask } from "@exegol/shared";
import { AGENT_CLI_TYPES } from "@exegol/shared";
import { Badge, Button, cn } from "@exegol/ui";
import { ArrowLeft, Clock, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useCreateScheduledTask,
  useDeleteScheduledTask,
  useRunScheduledTaskNow,
  useScheduledResults,
  useScheduledTasks,
  useToggleScheduledTask,
  useUpdateScheduledTask,
} from "../../../hooks/use-trpc";
import { CronBuilder } from "../../common/CronBuilder";
import { EmptyState } from "../../common/EmptyState";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCron(expr: string): string {
  const presets: Record<string, string> = {
    "* * * * *": "Every minute",
    "*/5 * * * *": "Every 5 min",
    "*/15 * * * *": "Every 15 min",
    "0 * * * *": "Every hour",
    "0 */6 * * *": "Every 6 hours",
    "0 9 * * *": "Daily at 9 AM",
    "0 0 * * *": "Daily at midnight",
    "0 9 * * 1-5": "Weekdays at 9 AM",
    "0 0 * * 0": "Weekly (Sunday)",
  };
  return presets[expr] ?? expr;
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-500/20 text-green-400",
  failure: "bg-red-500/20 text-red-400",
  timeout: "bg-yellow-500/20 text-yellow-400",
  budget_exceeded: "bg-orange-500/20 text-orange-400",
};

// ─── Task Dialog (Create & Edit, unified) ───────────────────────────────────

function TaskDialog({
  title,
  submitLabel,
  isPending,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  isPending: boolean;
  initial: {
    prompt: string;
    cronExpression: string;
    cliAgent: string;
    maxTokenBudget: string;
    dependsOn: string;
  };
  onSubmit: (data: {
    prompt: string;
    cronExpression: string;
    cliAgent: string;
    maxTokenBudget: string;
    dependsOn: string;
  }) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(initial.prompt);
  const [cronExpression, setCronExpression] = useState(initial.cronExpression);
  const [cliAgent, setCliAgent] = useState(initial.cliAgent);
  const [maxTokenBudget, setMaxTokenBudget] = useState(initial.maxTokenBudget);
  const [dependsOn, setDependsOn] = useState(initial.dependsOn);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ prompt, cronExpression, cliAgent, maxTokenBudget, dependsOn });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-bg-primary p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-text-muted">Prompt</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              rows={3}
              required
            />
          </div>
          <CronBuilder value={cronExpression} onChange={setCronExpression} />
          <div>
            <div className="mb-1 text-xs text-text-muted">Agent CLI</div>
            <select
              value={cliAgent}
              onChange={(e) => setCliAgent(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {AGENT_CLI_TYPES.map((cli) => (
                <option key={cli} value={cli}>
                  {cli}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Max Token Budget (optional)</div>
            <input
              value={maxTokenBudget}
              onChange={(e) => setMaxTokenBudget(e.target.value)}
              placeholder="e.g. 100000"
              type="number"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">
              Depends On (task IDs, comma-separated)
            </div>
            <input
              value={dependsOn}
              onChange={(e) => setDependsOn(e.target.value)}
              placeholder="e.g. abc123, def456"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} className="text-xs text-text-muted">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!prompt || !cronExpression || isPending}
            className="gap-1 bg-accent text-xs text-white"
          >
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Task Detail (execution history) ────────────────────────────────────────

function TaskDetail({ task, onBack }: { task: ScheduledTask; onBack: () => void }) {
  const { data: results } = useScheduledResults(task.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="text-text-muted hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold text-text-primary">{task.prompt}</h3>
          <p className="text-[10px] text-text-muted">
            {formatCron(task.cronExpression)} &middot; {task.cliAgent}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <h4 className="mb-2 text-xs font-medium text-text-secondary">Execution History</h4>
        {results && results.length > 0 ? (
          <div className="space-y-2">
            {results.map((r: ScheduledResult) => (
              <div key={r.id} className="rounded-lg border border-border bg-bg-secondary p-3">
                <div className="flex items-center justify-between">
                  <Badge className={cn("text-[10px]", STATUS_COLORS[r.status] ?? "")}>
                    {r.status}
                  </Badge>
                  <span className="text-[10px] text-text-muted">{formatTime(r.createdAt)}</span>
                </div>
                {r.summary && <p className="mt-1 text-[10px] text-text-muted">{r.summary}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-text-muted">No executions yet</p>
        )}
      </div>
    </div>
  );
}

// ─── Task Row ───────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onSelect,
  onEdit,
}: {
  task: ScheduledTask;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const toggleTask = useToggleScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const runNow = useRunScheduledTaskNow();

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <button
        type="button"
        onClick={() => toggleTask.mutate({ id: task.id, enabled: !task.enabled })}
        className={cn(
          "shrink-0 rounded p-1 transition-colors",
          task.enabled
            ? "text-green-400 hover:bg-green-500/10"
            : "text-text-muted hover:bg-white/5",
        )}
        title={task.enabled ? "Pause" : "Resume"}
      >
        {task.enabled ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </button>

      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-xs font-medium text-text-primary">{task.prompt}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
          <span>{formatCron(task.cronExpression)}</span>
          <span>&middot;</span>
          <span>{task.cliAgent}</span>
          {task.nextRunAt && (
            <>
              <span>&middot;</span>
              <span>Next: {formatTime(task.nextRunAt)}</span>
            </>
          )}
          {task.dependsOn && (
            <>
              <span>&middot;</span>
              <span className="text-yellow-400">Depends on: {task.dependsOn}</span>
            </>
          )}
        </div>
      </button>

      {task.lastResultStatus && (
        <Badge className={cn("shrink-0 text-[10px]", STATUS_COLORS[task.lastResultStatus] ?? "")}>
          {task.lastResultStatus}
        </Badge>
      )}

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => runNow.mutate(task.id)}
          className="rounded p-1 text-text-muted hover:bg-white/5 hover:text-accent"
          title="Run now"
        >
          <Play className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-text-muted hover:bg-white/5 hover:text-accent"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => deleteTask.mutate(task.id)}
          className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function SchedulerSection() {
  const { projectId } = useProjectContext();
  const { data: tasks } = useScheduledTasks(projectId);
  const createTask = useCreateScheduledTask();
  const updateTask = useUpdateScheduledTask();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = tasks?.find((t) => t.id === selectedTaskId);

  if (selectedTask) {
    return <TaskDetail task={selectedTask} onBack={() => setSelectedTaskId(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Scheduler</h2>
        <Button
          type="button"
          onClick={() => setShowNewDialog(true)}
          className="gap-1 bg-accent text-[11px] text-white"
          disabled={!projectId}
        >
          <Plus className="h-3 w-3" />
          New Task
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onSelect={() => setSelectedTaskId(task.id)}
                onEdit={() => setEditingTask(task)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Clock className="h-8 w-8 text-text-muted" />}
            title="No scheduled tasks"
            description="Create recurring agent tasks that run on a cron schedule."
            action={
              projectId ? { label: "New Task", onClick: () => setShowNewDialog(true) } : undefined
            }
          />
        )}
      </div>

      {showNewDialog && projectId && (
        <TaskDialog
          title="New Scheduled Task"
          submitLabel="Create Task"
          isPending={createTask.isPending}
          initial={{
            prompt: "",
            cronExpression: "0 9 * * *",
            cliAgent: "claude-code",
            maxTokenBudget: "",
            dependsOn: "",
          }}
          onSubmit={async (data) => {
            await createTask.mutateAsync({
              projectId,
              prompt: data.prompt,
              cronExpression: data.cronExpression,
              cliAgent: data.cliAgent,
              maxTokenBudget: data.maxTokenBudget
                ? Number.parseInt(data.maxTokenBudget, 10)
                : undefined,
              dependsOn: data.dependsOn || undefined,
            });
            setShowNewDialog(false);
          }}
          onClose={() => setShowNewDialog(false)}
        />
      )}

      {editingTask && (
        <TaskDialog
          title="Edit Scheduled Task"
          submitLabel="Save Changes"
          isPending={updateTask.isPending}
          initial={{
            prompt: editingTask.prompt,
            cronExpression: editingTask.cronExpression,
            cliAgent: editingTask.cliAgent,
            maxTokenBudget: editingTask.maxTokenBudget ? String(editingTask.maxTokenBudget) : "",
            dependsOn: editingTask.dependsOn ?? "",
          }}
          onSubmit={async (data) => {
            await updateTask.mutateAsync({
              id: editingTask.id,
              prompt: data.prompt,
              cronExpression: data.cronExpression,
              cliAgent: data.cliAgent,
              maxTokenBudget: data.maxTokenBudget
                ? Number.parseInt(data.maxTokenBudget, 10)
                : undefined,
              dependsOn: data.dependsOn || undefined,
            });
            setEditingTask(null);
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
