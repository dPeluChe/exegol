import { useState } from 'react'
import { Rocket, Cpu } from 'lucide-react'
import { Button } from '@exegol/ui'
import { useAppStore } from '../../stores/app'
import { useAgentStore } from '../../stores/agents'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { TerminalTabs } from '../terminal/TerminalTabs'
import { SpawnAgentDialog } from '../agents/SpawnAgentDialog'

export function WorkspaceView() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const agents = Object.values(useAgentStore((s) => s.agents))
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId)
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)

  const hasAgents = agents.length > 0

  if (!activeProjectId) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: 'var(--bg-primary)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Select a project to get started
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-primary)' }}>
      {hasAgents ? (
        <>
          {/* Tab bar */}
          <TerminalTabs onSpawnClick={() => setSpawnDialogOpen(true)} />

          {/* Terminal area */}
          <div className="flex-1 overflow-hidden">
            {focusedAgentId ? (
              <TerminalPanel key={focusedAgentId} agentId={focusedAgentId} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Select an agent tab to view its terminal
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Empty state */
        <div className="flex h-full flex-col items-center justify-center gap-6">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{ background: 'var(--bg-secondary)' }}
          >
            <Cpu className="h-10 w-10" style={{ color: 'var(--text-muted)' }} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              No agents running
            </h2>
            <p className="mt-1 max-w-sm text-xs" style={{ color: 'var(--text-muted)' }}>
              Launch your first agent to start working. Each agent runs in its own
              terminal with an isolated git worktree.
            </p>
          </div>
          <Button
            onClick={() => setSpawnDialogOpen(true)}
            className="gap-2 text-white"
            style={{ background: 'var(--accent)' }}
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
        projectId={activeProjectId}
      />
    </div>
  )
}
