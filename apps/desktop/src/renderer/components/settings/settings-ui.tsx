import { cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";

/** The small outlined action button of the Models and Storage tabs */
export const SMALL_BUTTON =
  "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-tertiary disabled:opacity-50";

/** A setting that is on or off: the whole row toggles it */
export function SwitchRow({
  label,
  description,
  value,
  onToggle,
  icon: Icon,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
        value
          ? "border-accent bg-accent/10"
          : "border-border bg-bg-secondary hover:border-accent/30 hover:bg-white/5",
      )}
    >
      {Icon && (
        <Icon className={cn("h-4 w-4 shrink-0", value ? "text-accent" : "text-text-muted")} />
      )}
      <div className="flex-1">
        <p className={cn("text-xs font-medium", value ? "text-accent" : "text-text-secondary")}>
          {label}
        </p>
        <p className="text-[10px] text-text-muted">{description}</p>
      </div>
      <div
        className={cn(
          "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors",
          value ? "bg-accent" : "bg-border",
        )}
      >
        <div
          className={cn(
            "h-4 w-4 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-4" : "translate-x-0",
          )}
        />
      </div>
    </button>
  );
}
