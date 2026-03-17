import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TooltipProvider } from '@exegol/ui'
import { useAppStore } from './stores/app'
import { TitleBar } from './components/layout/TitleBar'
import { StatusBar } from './components/layout/StatusBar'
import { Sidebar } from './components/layout/Sidebar'
import { WorkspaceView } from './components/workspace/WorkspaceView'
import { ProjectList } from './components/projects/ProjectList'
import { SettingsPanel } from './components/settings/SettingsPanel'

function MainContent() {
  const activeView = useAppStore((s) => s.activeView)

  switch (activeView) {
    case 'projects':
      return <ProjectList />
    case 'workspace':
      return <WorkspaceView />
    case 'settings':
      return <SettingsPanel />
    default:
      return <ProjectList />
  }
}

export default function App() {
  const activeView = useAppStore((s) => s.activeView)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle sidebar with Cmd/Ctrl + B
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        useAppStore.getState().toggleSidebar()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const showSidebar = activeView === 'workspace'

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col" style={{ background: 'var(--bg-primary)' }}>
        <TitleBar />

        <div className="flex-1 overflow-hidden">
          {showSidebar ? (
            <PanelGroup direction="horizontal" autoSaveId="exegol-layout">
              {!sidebarCollapsed && (
                <>
                  <Panel
                    id="sidebar"
                    order={1}
                    defaultSize={20}
                    minSize={15}
                    maxSize={35}
                  >
                    <Sidebar />
                  </Panel>
                  <PanelResizeHandle
                    className="w-px hover:w-0.5 transition-all"
                    style={{ background: 'var(--border)' }}
                  />
                </>
              )}
              <Panel id="main" order={2} defaultSize={80}>
                <MainContent />
              </Panel>
            </PanelGroup>
          ) : (
            <MainContent />
          )}
        </div>

        <StatusBar />
      </div>
    </TooltipProvider>
  )
}
