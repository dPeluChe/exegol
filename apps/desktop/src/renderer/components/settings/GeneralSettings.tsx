import { Input } from '@exegol/ui'
import type { Settings, IdeType } from '@exegol/shared'

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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-text-secondary">
      {children}
    </label>
  )
}

export interface GeneralSettingsProps {
  settings: Settings
  onChange: (updates: Partial<Settings>) => void
}

export function GeneralSettings({ settings, onChange }: GeneralSettingsProps) {
  return (
    <div
      className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4"
    >
      <div className="space-y-1.5">
        <FieldLabel>Theme</FieldLabel>
        <select
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value as Settings['theme'] })}
          className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary"
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <FieldLabel>Default IDE</FieldLabel>
        <select
          value={settings.defaultIde}
          onChange={(e) => onChange({ defaultIde: e.target.value as IdeType })}
          className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary"
        >
          {IDE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {settings.defaultIde === 'custom' && (
        <div className="space-y-1.5">
          <FieldLabel>Custom IDE Path</FieldLabel>
          <Input
            value={settings.customIdePath ?? ''}
            onChange={(e) => onChange({ customIdePath: e.target.value || null })}
            placeholder="/usr/local/bin/my-editor"
            className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel>Global Hotkey</FieldLabel>
        <Input
          value={settings.globalHotkey}
          onChange={(e) => onChange({ globalHotkey: e.target.value })}
          placeholder="CommandOrControl+Shift+E"
          className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
        />
        <p className="text-[10px] text-text-muted">
          Electron accelerator format (e.g., CommandOrControl+Shift+E)
        </p>
      </div>
    </div>
  )
}
