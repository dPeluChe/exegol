import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Rocket } from 'lucide-react'
import { Button, Input, cn } from '@exegol/ui'
import { AGENT_CLI_TYPES, type AgentCliType } from '@exegol/shared'
import { useSpawnAgent } from '../../hooks/use-trpc'
import { useAgentStore } from '../../stores/agents'
import { useTerminalStore } from '../../stores/terminals'

const CLI_LABELS: Record<AgentCliType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  aider: 'Aider',
  opencode: 'OpenCode',
  goose: 'Goose',
  amp: 'Amp',
  kiro: 'Kiro',
  custom: 'Custom',
}

interface SpawnAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function SpawnAgentDialog({ open, onOpenChange, projectId }: SpawnAgentDialogProps) {
  const [cliType, setCliType] = useState<AgentCliType>('claude-code')
  const [taskDescription, setTaskDescription] = useState('')
  const [useWorktree, setUseWorktree] = useState(true)
  const [branchName, setBranchName] = useState('')

  const spawnAgent = useSpawnAgent()
  const addAgent = useAgentStore((s) => s.addAgent)
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent)
  const createTerminal = useTerminalStore((s) => s.createTerminal)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskDescription.trim()) return

    try {
      const agent = await spawnAgent.mutateAsync({
        projectId,
        cliType,
        taskDescription: taskDescription.trim(),
        useWorktree,
      })

      addAgent({
        id: agent.id,
        projectId,
        cliType: agent.cliType,
        status: agent.status,
        currentStep: agent.currentStep,
        taskDescription: agent.taskDescription,
        branchName: branchName || null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: agent.startedAt,
      })

      createTerminal(agent.id)
      setFocusedAgent(agent.id)

      // Reset form
      setTaskDescription('')
      setBranchName('')
      setUseWorktree(true)
      onOpenChange(false)
    } catch {
      // Error is handled by the mutation state
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title
              className="text-base font-semibold text-text-primary"
            >
              Launch Agent
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* CLI Type */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium text-text-secondary"
              >
                Agent CLI
              </label>
              <select
                value={cliType}
                onChange={(e) => setCliType(e.target.value as AgentCliType)}
                className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1"
              >
                {AGENT_CLI_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CLI_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            {/* Task Description */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-medium text-text-secondary"
              >
                Task Description
              </label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Describe what the agent should do..."
                rows={3}
                className="flex w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary transition-colors placeholder:text-zinc-600 focus:outline-none focus:ring-1"
                style={{
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Use Worktree */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="use-worktree"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
                className="h-4 w-4 rounded border border-border accent-[var(--accent)]"
              />
              <label
                htmlFor="use-worktree"
                className="text-xs text-text-secondary"
              >
                Use git worktree (isolated branch)
              </label>
            </div>

            {/* Branch Name */}
            {useWorktree && (
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-text-secondary"
                >
                  Branch Name
                  <span className="ml-1 font-normal text-text-muted">
                    (optional, auto-generated if empty)
                  </span>
                </label>
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature/my-branch"
                  className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
              </div>
            )}

            {/* Error */}
            {spawnAgent.isError && (
              <p className="text-xs text-error">
                Failed to spawn agent:{' '}
                {spawnAgent.error instanceof Error
                  ? spawnAgent.error.message
                  : 'Unknown error'}
              </p>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!taskDescription.trim() || spawnAgent.isPending}
                className={cn(
                  'gap-2 bg-accent text-white',
                  spawnAgent.isPending && 'opacity-60',
                )}
              >
                <Rocket className="h-4 w-4" />
                {spawnAgent.isPending ? 'Launching...' : 'Launch Agent'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
