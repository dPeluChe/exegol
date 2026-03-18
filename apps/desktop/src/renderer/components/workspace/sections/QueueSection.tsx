import type { AgentProvider, QueueTask, QueueTaskStatus } from "@exegol/shared";
import { Badge, Button, cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListOrdered, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { EmptyState } from "../../common/EmptyState";

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listProviders"),
    staleTime: 60_000,
  });
}

function useQueueTasks(projectId?: string) {
  return useQuery({
    queryKey: ["queue", projectId ?? "all"],
    queryFn: () => trpcInvoke<QueueTask[]>("queue.list", projectId ? { projectId } : undefined),
    refetchInterval: 5_000,
  });
}

function useAddToQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      prompt: string;
      cliType?: string;
      priority?: number;
      dependsOn?: string | null;
    }) => trpcMutate<QueueTask>("queue.add", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

function useCancelQueueTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcMutate<{ success: boolean }>("queue.cancel", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<QueueTaskStatus, string> = {
  queued: "bg-blue-500/20 text-blue-400",
  running: "bg-green-500/20 text-green-400",
  blocked: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-gray-500/20 text-gray-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-500",
};

// ─── Add Task Dialog ─────────────────────────────────────────────────────────

function AddTaskDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const addToQueue = useAddToQueue();
  const { data: providers } = useProviders();
  const [prompt, setPrompt] = useState("");
  const [cliType, setCliType] = useState(providers?.[0]?.id ?? "claude-code");
  const [priority, setPriority] = useState("0");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addToQueue.mutateAsync({
      projectId,
      prompt,
      cliType,
      priority: Number.parseInt(priority, 10),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-bg-primary p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Add to Queue</h3>
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
            <div className="mb-1 text-xs text-text-muted">Task Prompt</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              rows={3}
              required
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Agent CLI</div>
            <select
              value={cliType}
              onChange={(e) => setCliType(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-text-muted">Priority (higher = first)</div>
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              type="number"
              className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} className="text-xs text-text-muted">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!prompt || addToQueue.isPending}
            className="gap-1 bg-accent text-xs text-white"
          >
            <Plus className="h-3 w-3" />
            {addToQueue.isPending ? "Adding..." : "Add to Queue"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Queue Task Row ──────────────────────────────────────────────────────────

function QueueTaskRow({ task }: { task: QueueTask }) {
  const cancelTask = useCancelQueueTask();
  const isCancellable = task.status === "queued" || task.status === "blocked";

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-text-primary">{task.prompt}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
          <span>{task.cliType}</span>
          <span>&middot;</span>
          <span>Priority: {task.priority}</span>
          {task.startedAt && (
            <>
              <span>&middot;</span>
              <span>Started: {formatTime(task.startedAt)}</span>
            </>
          )}
          {task.dependsOn && (
            <>
              <span>&middot;</span>
              <span>Depends on: {task.dependsOn.slice(0, 8)}</span>
            </>
          )}
        </div>
      </div>

      <Badge className={cn("shrink-0 text-[10px]", STATUS_COLORS[task.status])}>
        {task.status}
      </Badge>

      {isCancellable && (
        <button
          type="button"
          onClick={() => cancelTask.mutate(task.id)}
          className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          title="Cancel"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────────────────

export function QueueSection() {
  const { projectId } = useProjectContext();
  const { data: tasks } = useQueueTasks(projectId ?? undefined);
  const [showAddDialog, setShowAddDialog] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Task Queue</h2>
        <Button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="gap-1 bg-accent text-[11px] text-white"
          disabled={!projectId}
        >
          <Plus className="h-3 w-3" />
          Add Task
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <QueueTaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ListOrdered className="h-8 w-8 text-text-muted" />}
            title="Queue is empty"
            description="Add tasks to the queue for sequential or parallel execution with priority ordering."
            action={
              projectId ? { label: "Add Task", onClick: () => setShowAddDialog(true) } : undefined
            }
          />
        )}
      </div>

      {showAddDialog && projectId && (
        <AddTaskDialog projectId={projectId} onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  );
}
