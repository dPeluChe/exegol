import { LayoutGrid } from 'lucide-react'
import { useAppStore } from '../../stores/app'
import { useAppVersion } from '../../hooks/use-trpc'

export function SidebarFooter() {
  const { data: appVersion } = useAppVersion()

  return (
    <div className="flex items-center justify-between px-3 py-2">
      <button
        onClick={() => {
          useAppStore.getState().setActiveProject(null)
        }}
        className="flex items-center gap-1.5 text-[11px] text-text-muted transition-colors hover:text-text-secondary"
      >
        <LayoutGrid className="h-3 w-3" />
        All Projects
      </button>
      {appVersion && (
        <span className="text-[10px] text-text-muted">v{appVersion}</span>
      )}
    </div>
  )
}
