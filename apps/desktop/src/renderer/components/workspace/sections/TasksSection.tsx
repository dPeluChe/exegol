import { CheckSquare } from 'lucide-react'
import { EmptyState } from '../../common/EmptyState'

export function TasksSection() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-2 rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
        Coming Soon
      </div>
      <EmptyState
        icon={<CheckSquare className="h-8 w-8 text-text-muted" />}
        title="Task Viewer"
        description="Load and manage tasks from markdown files. Track progress with checkboxes."
        action={{ label: 'Coming in Phase 2', onClick: () => {} }}
      />
    </div>
  )
}
