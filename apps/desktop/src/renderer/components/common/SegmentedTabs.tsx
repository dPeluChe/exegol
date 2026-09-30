import { cn } from "@exegol/ui";

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
}: {
  tabs: SegmentedTab<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Sidebar size */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-1 rounded-lg border border-border bg-bg-tertiary",
        compact ? "p-0.5" : "p-1",
      )}
    >
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 rounded-md font-medium transition-colors",
            compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
            active === tab.id
              ? "bg-bg-secondary text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "ml-1.5 text-[10px]",
                tab.alert ? "font-semibold text-amber-400" : "text-text-muted",
              )}
            >
              ({tab.count})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
