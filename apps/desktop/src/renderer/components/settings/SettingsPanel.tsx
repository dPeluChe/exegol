import { useEffect, useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { Button, Separator } from '@exegol/ui'
import { useSettings, useUpdateSettings } from '../../hooks/use-trpc'
import type { Settings } from '@exegol/shared'
import { GeneralSettings } from './GeneralSettings'
import { CliSettings } from './CliSettings'
import { TerminalSettings } from './TerminalSettings'

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-text-primary">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-xs text-text-muted">
          {description}
        </p>
      )}
    </div>
  )
}

export function SettingsPanel() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [form, setForm] = useState<Settings | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (settings && !form) {
      setForm(settings)
    }
  }, [settings, form])

  if (isLoading || !form) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    )
  }

  const updateField = (updates: Partial<Settings>) => {
    setForm((prev) => (prev ? { ...prev, ...updates } : prev))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!form) return
    await updateSettings.mutateAsync(form)
    setDirty(false)
  }

  const handleReset = () => {
    if (settings) {
      setForm(settings)
      setDirty(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
          <p className="text-xs text-text-muted">Configure Exegol preferences</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1 text-[var(--text-secondary)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || updateSettings.isPending}
            className="gap-1 text-white"
            style={{ background: dirty ? 'var(--accent)' : undefined }}
          >
            <Save className="h-3.5 w-3.5" />
            {updateSettings.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* General */}
          <section>
            <SectionHeader title="General" description="Basic application preferences" />
            <GeneralSettings settings={form} onChange={updateField} />
          </section>

          <Separator className="bg-border" />

          {/* Agent CLIs */}
          <section>
            <SectionHeader title="Agent CLIs" description="Configure available CLI agents and their commands" />
            <CliSettings
              clis={form.agentClis}
              onChange={(clis) => updateField({ agentClis: clis })}
            />
          </section>

          <Separator className="bg-border" />

          {/* Terminal */}
          <section>
            <SectionHeader title="Terminal" description="Terminal appearance settings" />
            <TerminalSettings settings={form} onChange={updateField} />
          </section>

          {/* Save error */}
          {updateSettings.isError && (
            <p className="text-xs text-error">
              Failed to save settings:{' '}
              {updateSettings.error instanceof Error ? updateSettings.error.message : 'Unknown error'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
