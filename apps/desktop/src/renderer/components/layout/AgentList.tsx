import { Plus } from 'lucide-react'
import { ScrollArea, cn } from '@exegol/ui'
import { useAgentStore } from '../../stores/agents'
import { AgentCard } from '../agents/AgentCard'

export interface AgentListProps {
  projectId: string | null
  onSpawnClick: () => void
}

export function AgentList({ projectId, onSpawnClick }: AgentListProps) {
  const agents = Object.values(useAgentStore((s) => s.agents))
  const projectAgents = agents.filter((a) => a.projectId === projectId)

  return (
    <>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span
          className="text-[11px] font-medium uppercase tracking-wider text-text-muted"
        >
          Agents
        </span>
        <button
          onClick={onSpawnClick}
          disabled={!projectId}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors',
            projectId
              ? 'hover:bg-white/10 cursor-pointer'
              : 'opacity-30 cursor-not-allowed',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 py-1">
          {projectAgents.length > 0 ? (
            projectAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))
          ) : (
            <p
              className="px-2 py-4 text-center text-xs text-text-muted"
            >
              {projectId ? 'No agents running' : 'Select a project first'}
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
