import { useState, useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Rocket, Cpu } from 'lucide-react'
import { Button } from '@exegol/ui'
import { useAgentStore } from '../../../stores/agents'
import { useProjectContext } from '../../../contexts/ProjectContext'
import { TerminalPanel } from '../../terminal/TerminalPanel'
import { TerminalTabs } from '../../terminal/TerminalTabs'
import { SpawnAgentDialog } from '../../agents/SpawnAgentDialog'

export function AgentsSection() {
  const { projectId, agents } = useProjectContext()
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId)
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)
  const [secondaryPanel, setSecondaryPanel] = useState<React.ReactNode | null>(null)

  useEffect(() => {
    const handler = () => setSpawnDialogOpen(true)
    window.addEventListener('exegol:spawn-agent', handler)
    return () => window.removeEventListener('exegol:spawn-agent', handler)
  }, [])

  const hasAgents = agents.length > 0

  if (!projectId) return null

  return (
    <div className="flex h-full flex-col">
      {hasAgents ? (
        <>
          {/* Tab bar */}
          <TerminalTabs onSpawnClick={() => setSpawnDialogOpen(true)} />

          {/* Resizable panel layout */}
          <PanelGroup direction="horizontal" autoSaveId="workspace-panels">
            {/* Main terminal panel - always visible */}
            <Panel id="terminal" order={1} defaultSize={secondaryPanel ? 60 : 100}>
              {focusedAgentId ? (
                <TerminalPanel key={focusedAgentId} agentId={focusedAgentId} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-text-muted">
                    Select an agent tab to view its terminal
                  </p>
                </div>
              )}
            </Panel>

            {/* Secondary panel - for diff viewer, browser preview, etc. (Phase 2) */}
            {secondaryPanel && (
              <>
                <PanelResizeHandle
                  className="w-px hover:w-0.5 transition-all bg-border"
                />
                <Panel id="secondary" order={2} defaultSize={40} minSize={20}>
                  {secondaryPanel}
                </Panel>
              </>
            )}
          </PanelGroup>
        </>
      ) : (
        /* Empty state */
        <div className="flex h-full flex-col items-center justify-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-bg-secondary">
            <Cpu className="h-10 w-10 text-text-muted" />
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-text-primary">
              No agents running
            </h2>
            <p className="mt-1 max-w-sm text-xs text-text-muted">
              Launch your first agent to start working. Each agent runs in its own
              terminal with an isolated git worktree.
            </p>
          </div>
          <Button
            onClick={() => setSpawnDialogOpen(true)}
            className="gap-2 bg-accent text-white"
          >
            <Rocket className="h-4 w-4" />
            Launch Your First Agent
          </Button>
        </div>
      )}

      {/* Spawn dialog */}
      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        projectId={projectId}
      />
    </div>
  )
}
