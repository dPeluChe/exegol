import { Clock } from "lucide-react";
import { useScheduledTasks } from "../../hooks/use-trpc";

/**
 * Global overview of all scheduled tasks across all projects.
 * Shows in the sidebar as a collapsible section.
 */
export function SchedulersOverview() {
  const { data: tasks } = useScheduledTasks();

  if (!tasks || tasks.length === 0) {
    return <p className="text-[10px] italic text-text-muted">No scheduled tasks yet</p>;
  }

  const activeTasks = tasks.filter((t) => t.enabled);
  const nextTask = activeTasks
    .filter((t) => t.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];

  const lastResult = tasks
    .filter((t) => t.lastResultStatus)
    .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))[0];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <span className="font-medium text-text-secondary">{activeTasks.length}</span>
        <span>active task{activeTasks.length !== 1 ? "s" : ""}</span>
      </div>

      {nextTask?.nextRunAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <Clock className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            Next:{" "}
            {new Date(nextTask.nextRunAt * 1000).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {lastResult?.lastResultStatus && (
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span
            className={
              lastResult.lastResultStatus === "success" ? "text-green-400" : "text-red-400"
            }
          >
            Last: {lastResult.lastResultStatus}
          </span>
        </div>
      )}
    </div>
  );
}
