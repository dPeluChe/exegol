interface Shortcut {
  id: string
  label: string
  description: string
  keys: string
  category: 'navigation' | 'agents' | 'terminal'
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', description: 'Show/hide the agent sidebar', keys: 'Cmd+B', category: 'navigation' },
  { id: 'global-hotkey', label: 'Focus Exegol', description: 'Bring Exegol to front', keys: 'Cmd+Shift+E', category: 'navigation' },
  { id: 'settings', label: 'Open Settings', description: 'Open settings panel', keys: 'Cmd+,', category: 'navigation' },
  { id: 'projects', label: 'Go to Projects', description: 'Switch to projects view', keys: 'Cmd+Shift+P', category: 'navigation' },
  { id: 'new-agent', label: 'New Agent', description: 'Open spawn agent dialog', keys: 'Cmd+N', category: 'agents' },
  { id: 'stop-agent', label: 'Stop Agent', description: 'Stop the focused agent', keys: 'Cmd+.', category: 'agents' },
  { id: 'next-tab', label: 'Next Tab', description: 'Focus next agent terminal', keys: 'Cmd+]', category: 'terminal' },
  { id: 'prev-tab', label: 'Previous Tab', description: 'Focus previous agent terminal', keys: 'Cmd+[', category: 'terminal' },
]

const CATEGORY_LABELS: Record<Shortcut['category'], string> = {
  navigation: 'Navigation',
  agents: 'Agents',
  terminal: 'Terminal',
}

const CATEGORY_ORDER: Shortcut['category'][] = ['navigation', 'agents', 'terminal']

function KeyBadge({ keys }: { keys: string }) {
  const parts = keys.split('+')
  return (
    <div className="flex items-center gap-1">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[24px] items-center justify-center rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
        >
          {part}
        </kbd>
      ))}
    </div>
  )
}

export function KeyboardShortcuts() {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    shortcuts: DEFAULT_SHORTCUTS.filter((s) => s.category === category),
  }))

  return (
    <div className="space-y-6">
      {grouped.map((group) => (
        <div key={group.category}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {group.label}
          </h3>
          <div className="space-y-1">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.id}
                className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {shortcut.label}
                  </p>
                  <p className="text-xs text-text-muted">
                    {shortcut.description}
                  </p>
                </div>
                <KeyBadge keys={shortcut.keys} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-text-muted">
        Shortcut editing will be available in a future update.
      </p>
    </div>
  )
}
