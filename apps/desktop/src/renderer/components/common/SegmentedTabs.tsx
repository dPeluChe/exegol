import { cn } from "@exegol/ui";
import { tabKeyTarget } from "../../lib/tab-keys";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  /** Optional badge — rendered as "(N)" next to the label. */
  count?: number;
  /** The count asks for the user (e.g. unread attention): shown in amber */
  alert?: boolean;
}

/** Settings-style segmented control (originally inline in KeyboardShortcuts). */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  compact = false,
  label,
  panelId,
}: {
  tabs: SegmentedTab<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Sidebar size */
  compact?: boolean;
  /** Accessible name of the tablist */
  label?: string;
  /** The tabpanel's id: each tab gets `${panelId}-${tab.id}` and points at the panel */
  panelId?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabKeyTarget(e.key, index, tabs.length);
    const tab = next === null ? undefined : tabs[next];
    if (next === null || !tab) return;
    e.preventDefault();
    onChange(tab.id);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex gap-1 rounded-lg border border-border bg-bg-tertiary",
        compact ? "p-0.5" : "p-1",
      )}
    >
      {tabs.map((tab, index) => {
        const selected = active === tab.id;
        return (
          <button
            type="button"
            role="tab"
            key={tab.id}
            id={panelId ? `${panelId}-${tab.id}` : undefined}
            aria-selected={selected}
            aria-controls={panelId && selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            title={tab.label}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center rounded-md font-medium transition-colors",
              compact ? "px-1.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
              selected
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <span className="min-w-0 truncate">{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  compact ? "ml-1" : "ml-1.5",
                  tab.alert ? "font-semibold text-amber-400" : "text-text-muted",
                )}
              >
                ({tab.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
