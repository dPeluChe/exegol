import { Clock, Plus } from 'lucide-react'

/**
 * Global overview of all scheduled tasks across all projects.
 * Shows in the sidebar as a collapsible section.
 * Per-project detail is in the workspace Scheduler tab.
 */
export function SchedulersOverview() {
  // TODO: Replace with real DB query for scheduled tasks across all projects
  // const { data: tasks } = useScheduledTasks()

  return (
    <div>
      <p className="text-[10px] italic text-text-muted">
        No scheduled tasks yet
      </p>
      {/* Future: list of scheduled tasks like:
        <div className="space-y-0.5">
          {tasks.map(task => (
            <div key={task.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/5">
              <Clock className="h-2.5 w-2.5 shrink-0" />
              <span className="flex-1 truncate">{task.prompt}</span>
              <span className="shrink-0 text-[9px]">{task.cronExpression}</span>
            </div>
          ))}
        </div>
      */}
    </div>
  )
}
