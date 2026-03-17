import { cn } from '@exegol/ui'
import { Cpu, MemoryStick, HardDrive, Clock, FolderGit2, GitBranch } from 'lucide-react'
import { useSystemMetrics, useProjectMetrics } from '../../../hooks/use-trpc'
import { useProjectContext } from '../../../contexts/ProjectContext'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function barColor(pct: number): string {
  if (pct < 60) return 'bg-green-500'
  if (pct < 85) return 'bg-yellow-500'
  return 'bg-red-500'
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  percentage,
  icon: Icon,
}: {
  label: string
  value: string
  percentage: number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-2 text-text-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-bg-tertiary">
        <div
          className={cn('h-full rounded-full transition-all', barColor(percentage))}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-text-muted">{percentage.toFixed(1)}% used</p>
    </div>
  )
}

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-2 text-text-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
    </div>
  )
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function ResourcesSection() {
  const { data: system } = useSystemMetrics()
  const { project } = useProjectContext()
  const { data: projectMetrics } = useProjectMetrics(
    project?.id ?? null,
    project?.path ?? null,
    project?.name ?? null
  )

  if (!system) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Collecting system metrics...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* System Overview */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">System Overview</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={Cpu}
            label={`CPU (${system.cpu.cores} cores)`}
            value={`${system.cpu.usage.toFixed(1)}%`}
            percentage={system.cpu.usage}
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={`${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`}
            percentage={system.memory.usagePercent}
          />
          <MetricCard
            icon={HardDrive}
            label="Disk"
            value={`${formatBytes(system.disk.used)} / ${formatBytes(system.disk.total)}`}
            percentage={system.disk.usagePercent}
          />
          <InfoCard
            icon={Clock}
            label="System Uptime"
            value={formatUptime(system.uptime)}
          />
        </div>
      </div>

      {/* Project Detail */}
      {project && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">
            Project: {project.name}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard
              icon={FolderGit2}
              label="Project Disk Usage"
              value={projectMetrics ? formatBytes(projectMetrics.diskUsage) : 'Calculating...'}
            />
            <InfoCard
              icon={GitBranch}
              label="Worktrees"
              value={projectMetrics ? String(projectMetrics.worktreeCount) : '...'}
            />
          </div>
          {projectMetrics && projectMetrics.agentProcesses.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold text-text-muted">Agent Processes</h4>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-bg-secondary text-text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">PID</th>
                      <th className="px-3 py-2 text-right font-medium">CPU</th>
                      <th className="px-3 py-2 text-right font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {projectMetrics.agentProcesses.map((proc) => (
                      <tr key={proc.pid} className="text-text-secondary">
                        <td className="px-3 py-1.5">{proc.pid}</td>
                        <td className="px-3 py-1.5 text-right">{proc.cpu.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right">{formatBytes(proc.memory)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CPU Model */}
      <p className="text-[10px] text-text-muted">{system.cpu.model}</p>
    </div>
  )
}
