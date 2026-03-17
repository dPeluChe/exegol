import { useEffect, useState } from 'react'
import { Save, RotateCcw, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Separator } from '@exegol/ui'
import { useSettings, useUpdateSettings } from '../../hooks/use-trpc'
import type { Settings, IdeType, AgentCliConfig } from '@exegol/shared'

const IDE_OPTIONS: { value: IdeType; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'zed', label: 'Zed' },
  { value: 'intellij', label: 'IntelliJ IDEA' },
  { value: 'webstorm', label: 'WebStorm' },
  { value: 'custom', label: 'Custom' },
]

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </label>
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
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading settings...</p>
      </div>
    )
  }

  const updateField = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
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

  const addCliConfig = () => {
    const newCli: AgentCliConfig = { cliType: 'custom', command: '', args: [], env: {} }
    updateField('agentClis', [...form.agentClis, newCli])
  }

  const updateCliConfig = (index: number, update: Partial<AgentCliConfig>) => {
    const updated = form.agentClis.map((cli, i) =>
      i === index ? { ...cli, ...update } : cli,
    )
    updateField('agentClis', updated)
  }

  const removeCliConfig = (index: number) => {
    updateField('agentClis', form.agentClis.filter((_, i) => i !== index))
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Configure Exegol preferences</p>
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
            <div className="space-y-4 rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <div className="space-y-1.5">
                <FieldLabel>Theme</FieldLabel>
                <select
                  value={form.theme}
                  onChange={(e) => updateField('theme', e.target.value as Settings['theme'])}
                  className="flex h-9 w-full rounded-md border px-3 py-1 text-sm"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {THEME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <FieldLabel>Default IDE</FieldLabel>
                <select
                  value={form.defaultIde}
                  onChange={(e) => updateField('defaultIde', e.target.value as IdeType)}
                  className="flex h-9 w-full rounded-md border px-3 py-1 text-sm"
                  style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {IDE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {form.defaultIde === 'custom' && (
                <div className="space-y-1.5">
                  <FieldLabel>Custom IDE Path</FieldLabel>
                  <Input
                    value={form.customIdePath ?? ''}
                    onChange={(e) => updateField('customIdePath', e.target.value || null)}
                    placeholder="/usr/local/bin/my-editor"
                    className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <FieldLabel>Global Hotkey</FieldLabel>
                <Input
                  value={form.globalHotkey}
                  onChange={(e) => updateField('globalHotkey', e.target.value)}
                  placeholder="CommandOrControl+Shift+E"
                  className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Electron accelerator format (e.g., CommandOrControl+Shift+E)
                </p>
              </div>
            </div>
          </section>

          <Separator style={{ background: 'var(--border)' }} />

          {/* Agent CLIs */}
          <section>
            <SectionHeader title="Agent CLIs" description="Configure available CLI agents and their commands" />
            <div className="space-y-2">
              {form.agentClis.map((cli, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-lg border p-3"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
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
                    className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors hover:bg-red-500/10"
                    style={{ color: 'var(--error)' }}
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
          </section>

          <Separator style={{ background: 'var(--border)' }} />

          {/* Terminal */}
          <section>
            <SectionHeader title="Terminal" description="Terminal appearance settings" />
            <div className="space-y-4 rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <div className="space-y-1.5">
                <FieldLabel>Font Size</FieldLabel>
                <Input
                  type="number"
                  min={8}
                  max={32}
                  value={form.terminalFontSize}
                  onChange={(e) => updateField('terminalFontSize', Number(e.target.value))}
                  className="w-24 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Font Family</FieldLabel>
                <Input
                  value={form.terminalFontFamily}
                  onChange={(e) => updateField('terminalFontFamily', e.target.value)}
                  placeholder="JetBrains Mono, Menlo, Monaco, monospace"
                  className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
              </div>
            </div>
          </section>

          {/* Save error */}
          {updateSettings.isError && (
            <p className="text-xs" style={{ color: 'var(--error)' }}>
              Failed to save settings:{' '}
              {updateSettings.error instanceof Error ? updateSettings.error.message : 'Unknown error'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
