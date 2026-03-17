import { Button, cn } from "@exegol/ui";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex h-60 flex-col items-center justify-center gap-4", className)}>
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "var(--bg-secondary)" }}
      >
        {icon}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        {description && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          onClick={action.onClick}
          className="gap-2 text-white"
          style={{ background: "var(--accent)" }}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
