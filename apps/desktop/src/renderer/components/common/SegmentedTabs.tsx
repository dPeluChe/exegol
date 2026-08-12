import { cn } from "@exegol/ui";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  /** Optional badge — rendered as "(N)" next to the label. */
  count?: number;
}

/** Settings-style segmented control (originally inline in KeyboardShortcuts). */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: SegmentedTab<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            active === tab.id
              ? "bg-bg-secondary text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 text-[10px] text-text-muted">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
