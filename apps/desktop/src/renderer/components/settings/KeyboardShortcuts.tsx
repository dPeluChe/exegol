import { useState } from 'react'
import { cn } from '@exegol/ui'

type ShortcutCategory = 'navigation' | 'agents' | 'terminal'

interface Shortcut {
  id: string
  label: string
  description: string
  keys: string
  category: ShortcutCategory
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  // Navigation
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', description: 'Show/hide the agent sidebar', keys: 'Cmd+B', category: 'navigation' },
  { id: 'settings', label: 'Open Settings', description: 'Open settings panel', keys: 'Cmd+,', category: 'navigation' },
  { id: 'projects', label: 'Go to Projects', description: 'Switch to projects view', keys: 'Cmd+Shift+P', category: 'navigation' },
  { id: 'global-hotkey', label: 'Focus Exegol', description: 'Bring Exegol to front', keys: 'Cmd+Shift+E', category: 'navigation' },
  { id: 'tab-agents', label: 'Agents Tab', description: 'Switch to Agents section', keys: 'Cmd+1', category: 'navigation' },
  { id: 'tab-tasks', label: 'Tasks Tab', description: 'Switch to Tasks section', keys: 'Cmd+2', category: 'navigation' },
  { id: 'tab-diff', label: 'Diff Tab', description: 'Switch to Diff Viewer', keys: 'Cmd+3', category: 'navigation' },
  { id: 'tab-scheduler', label: 'Scheduler Tab', description: 'Switch to Scheduler', keys: 'Cmd+4', category: 'navigation' },
  { id: 'tab-tokens', label: 'Tokens Tab', description: 'Switch to Token Usage', keys: 'Cmd+5', category: 'navigation' },
  { id: 'tab-resources', label: 'Resources Tab', description: 'Switch to Resources', keys: 'Cmd+6', category: 'navigation' },
  // Agents
  { id: 'new-agent', label: 'New Agent', description: 'Open spawn agent dialog', keys: 'Cmd+N', category: 'agents' },
  { id: 'stop-agent', label: 'Stop Agent', description: 'Stop the focused agent', keys: 'Cmd+.', category: 'agents' },
  // Terminal
  { id: 'next-tab', label: 'Next Tab', description: 'Focus next agent terminal', keys: 'Cmd+]', category: 'terminal' },
  { id: 'prev-tab', label: 'Previous Tab', description: 'Focus previous agent terminal', keys: 'Cmd+[', category: 'terminal' },
]

const TABS: { id: ShortcutCategory; label: string; count: number }[] = [
  { id: 'navigation', label: 'Navigation', count: DEFAULT_SHORTCUTS.filter(s => s.category === 'navigation').length },
  { id: 'agents', label: 'Agents', count: DEFAULT_SHORTCUTS.filter(s => s.category === 'agents').length },
  { id: 'terminal', label: 'Terminal', count: DEFAULT_SHORTCUTS.filter(s => s.category === 'terminal').length },
]

function KeyBadge({ keys }: { keys: string }) {
  const parts = keys.split('+')
  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[22px] items-center justify-center rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
        >
          {part}
        </kbd>
      ))}
    </div>
  )
}

export function KeyboardShortcuts() {
  const [activeTab, setActiveTab] = useState<ShortcutCategory>('navigation')
  const filtered = DEFAULT_SHORTCUTS.filter(s => s.category === activeTab)

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-bg-secondary text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {tab.label}
            <span className="ml-1.5 text-[10px] text-text-muted">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Shortcuts list */}
      <div className="space-y-1">
        {filtered.map(shortcut => (
          <div
            key={shortcut.id}
            className="flex items-center justify-between rounded-md border border-border bg-bg-secondary px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary">{shortcut.label}</p>
              <p className="text-[10px] text-text-muted">{shortcut.description}</p>
            </div>
            <KeyBadge keys={shortcut.keys} />
          </div>
        ))}
      </div>

      <p className="text-[10px] text-text-muted">
        Custom keybindings coming in a future update. Uses Cmd on macOS, Ctrl on Windows/Linux.
      </p>
    </div>
  )
}
