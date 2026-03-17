import { LayoutGrid, Settings } from 'lucide-react'
import { cn } from '@exegol/ui'

export interface NavSectionProps {
  activeView: string
  onNavigate: (view: 'projects' | 'workspace' | 'settings') => void
  appVersion?: string
}

export function NavSection({ activeView, onNavigate, appVersion }: NavSectionProps) {
  return (
    <>
      <div className="space-y-0.5 p-2">
        <button
          onClick={() => onNavigate('projects')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-text-secondary transition-colors',
            'hover:bg-white/5',
            activeView === 'projects' && 'bg-white/10',
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Projects
        </button>
        <button
          onClick={() => onNavigate('settings')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-text-secondary transition-colors',
            'hover:bg-white/5',
            activeView === 'settings' && 'bg-white/10',
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>

      <div className="border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-text-muted">
          Exegol v{appVersion ?? '...'}
        </span>
      </div>
    </>
  )
}
