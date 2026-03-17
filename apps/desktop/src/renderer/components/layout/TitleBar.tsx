import { Minus, Square, X } from 'lucide-react'
import { cn } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useProject } from '../../hooks/use-trpc'

export function TitleBar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const { data: project } = useProject(activeProjectId)
  const platform = window.api?.app?.getPlatform?.() ?? 'darwin'
  const isMac = platform === 'darwin'

  return (
    <div
      className={cn(
        'titlebar-drag flex h-10 shrink-0 items-center justify-between border-b px-3',
        isMac && 'pl-20',
      )}
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Left: App name */}
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-semibold tracking-wide"
          style={{ color: 'var(--accent)' }}
        >
          Exegol
        </span>
      </div>

      {/* Center: Active project */}
      <div className="absolute left-1/2 -translate-x-1/2">
        {project ? (
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {project.name}
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No project selected
          </span>
        )}
      </div>

      {/* Right: Window controls (non-macOS only) */}
      {!isMac && (
        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            onClick={() => window.api.windowControls.minimize()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
          >
            <Minus className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button
            onClick={() => window.api.windowControls.maximize()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/10"
          >
            <Square className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button
            onClick={() => window.api.windowControls.close()}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-500/80"
          >
            <X className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      )}
    </div>
  )
}
