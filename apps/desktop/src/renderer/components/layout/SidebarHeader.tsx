import { Settings } from 'lucide-react'
import { useAppStore } from '../../stores/app'

export function SidebarHeader() {
  const setActiveView = useAppStore((s) => s.setActiveView)

  return (
    <div className="flex h-10 items-center justify-between px-3 titlebar-drag">
      <span className="text-sm font-bold text-accent titlebar-no-drag">
        Exegol
      </span>
      <button
        onClick={() => setActiveView('settings')}
        className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text-secondary titlebar-no-drag"
        title="Settings"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
