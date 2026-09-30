import { useState } from "react";
import { useSettings } from "../../hooks/use-trpc";
import { IS_MAC } from "../../lib/keymap";
import { displayAccelerator, SHORTCUTS, type ShortcutCategory } from "../../lib/shortcuts";
import { type SegmentedTab, SegmentedTabs } from "../common/SegmentedTabs";

const TABS: SegmentedTab<ShortcutCategory>[] = [
  {
    id: "navigation",
    label: "Navigation",
    count: SHORTCUTS.filter((s) => s.category === "navigation").length,
  },
  {
    id: "agents",
    label: "Agents",
    count: SHORTCUTS.filter((s) => s.category === "agents").length,
  },
  {
    id: "terminal",
    label: "Terminal",
    count: SHORTCUTS.filter((s) => s.category === "terminal").length,
  },
];

function KeyBadge({ keys }: { keys: string }) {
  const parts = keys.split("+");
  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part) => (
        <kbd
          key={part}
          className="inline-flex min-w-[22px] items-center justify-center rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
        >
          {part}
        </kbd>
      ))}
    </div>
  );
}

export function KeyboardShortcuts() {
  const [activeTab, setActiveTab] = useState<ShortcutCategory>("navigation");
  const { data: settings } = useSettings();
  // The global hotkey is configurable (General): show the one in effect
  const globalHotkey = {
    id: "focus-exegol",
    label: "Focus Exegol",
    description: "Bring Exegol to front from any app (change it in General)",
    keys: displayAccelerator(settings?.globalHotkey ?? "CommandOrControl+Shift+E"),
    category: "navigation" as const,
  };
  const filtered = [...SHORTCUTS, globalHotkey].filter((s) => s.category === activeTab);

  return (
    <div className="space-y-4">
      <SegmentedTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* Shortcuts list */}
      <div className="space-y-1">
        {filtered.map((shortcut) => (
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
        {IS_MAC
          ? "On Linux and Windows, Cmd is Ctrl+Shift (and Cmd+Shift or Cmd+Option is Ctrl+Shift+Alt)."
          : "Ctrl+Shift, not Ctrl: Ctrl alone stays with the terminal (Ctrl+C, Ctrl+D, Ctrl+W)."}
      </p>
    </div>
  );
}
