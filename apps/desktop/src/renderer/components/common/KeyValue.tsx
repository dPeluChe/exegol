import { cn } from "@exegol/ui";

interface KeyValueProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function KeyValue({ label, value, icon, className }: KeyValueProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-1", className)}>
      <span
        className="flex shrink-0 items-center gap-1.5 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
        {label}
      </span>
      <span
        className="truncate text-right text-xs font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}
