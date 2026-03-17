import { Activity, HardDrive, Cpu, MemoryStick } from 'lucide-react'

/**
 * Global overview of host resources across all projects.
 * Shows in the sidebar as a collapsible section.
 * Per-project detail is in the workspace Resources tab.
 */
export function ResourcesOverview() {
  // TODO: Replace with real system metrics
  // const { data: metrics } = useHostMetrics()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-text-muted">
          <Cpu className="h-2.5 w-2.5" />
          CPU
        </span>
        <span className="text-text-secondary">—</span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-text-muted">
          <MemoryStick className="h-2.5 w-2.5" />
          Memory
        </span>
        <span className="text-text-secondary">—</span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-text-muted">
          <HardDrive className="h-2.5 w-2.5" />
          Disk
        </span>
        <span className="text-text-secondary">—</span>
      </div>
      <p className="pt-1 text-[9px] italic text-text-muted">
        Live metrics coming soon
      </p>
    </div>
  )
}
