import { Plus, Trash2 } from 'lucide-react'
import { Button, Input } from '@exegol/ui'
import type { AgentCliConfig } from '@exegol/shared'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-text-secondary">
      {children}
    </label>
  )
}

export interface CliSettingsProps {
  clis: AgentCliConfig[]
  onChange: (clis: AgentCliConfig[]) => void
}

export function CliSettings({ clis, onChange }: CliSettingsProps) {
  const addCliConfig = () => {
    const newCli: AgentCliConfig = { cliType: 'custom', command: '', args: [], env: {} }
    onChange([...clis, newCli])
  }

  const updateCliConfig = (index: number, update: Partial<AgentCliConfig>) => {
    const updated = clis.map((cli, i) =>
      i === index ? { ...cli, ...update } : cli,
    )
    onChange(updated)
  }

  const removeCliConfig = (index: number) => {
    onChange(clis.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {clis.map((cli, index) => (
        <div
          key={index}
          className="flex items-start gap-3 rounded-lg border border-border bg-bg-secondary p-3"
        >
          <div className="grid flex-1 grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>CLI Type</FieldLabel>
              <Input
                value={cli.cliType}
                onChange={(e) => updateCliConfig(index, { cliType: e.target.value })}
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Command</FieldLabel>
              <Input
                value={cli.command}
                onChange={(e) => updateCliConfig(index, { command: e.target.value })}
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <FieldLabel>Arguments (comma-separated)</FieldLabel>
              <Input
                value={cli.args.join(', ')}
                onChange={(e) =>
                  updateCliConfig(index, {
                    args: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="--flag, --other-flag"
                className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>
          </div>
          <button
            onClick={() => removeCliConfig(index)}
            className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded text-error transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={addCliConfig}
        className="gap-1 border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/5"
      >
        <Plus className="h-3.5 w-3.5" />
        Add CLI Agent
      </Button>
    </div>
  )
}
