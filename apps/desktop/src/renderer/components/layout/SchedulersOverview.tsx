import { Plus } from "lucide-react";
import { useScheduledTasks } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";

/**
 * Global overview of all scheduled tasks across all projects.
 * Shows in the sidebar as a collapsible section.
 */
export function SchedulersOverview() {
  const { data: tasks } = useScheduledTasks();
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const navigateToScheduler = () => {
    if (activeProjectId) {
      useAppStore.getState().setActiveView("workspace");
      // Dispatch event to switch workspace tab to scheduler
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "scheduler" } }),
      );
    }
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] italic text-text-muted">No scheduled tasks</p>
        {activeProjectId && (
          <button
            type="button"
            onClick={navigateToScheduler}
            className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover"
          >
            <Plus className="h-2.5 w-2.5" />
            Create task
          </button>
        )}
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => t.enabled);

  return (
    <div className="space-y-1">
      {/* Summary line — same pattern as Prompts */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-muted">
          <span className="font-medium text-text-secondary">{activeTasks.length}</span> active
          <span className="text-text-muted"> · {tasks.length} total</span>
        </span>
        <button
          type="button"
          onClick={navigateToScheduler}
          className="text-text-muted hover:text-accent"
        >
          View →
        </button>
      </div>

      {/* Last 3 tasks */}
      {tasks.slice(0, 3).map((task) => (
        <button
          type="button"
          key={task.id}
          onClick={navigateToScheduler}
          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/5"
        >
          <span className={task.enabled ? "text-green-400" : "text-zinc-500"}>
            {task.enabled ? "●" : "○"}
          </span>
          <span className="flex-1 truncate text-left">{task.prompt}</span>
        </button>
      ))}
    </div>
  );
}
