import { cn } from "@exegol/ui";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-4 w-4 border-[1.5px]",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
} as const;

export function LoadingSpinner({ size = "md", label, className }: LoadingSpinnerProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <div
        className={cn(
          "animate-spin rounded-full border-solid border-t-transparent",
          SIZE_CLASSES[size],
        )}
        style={{
          borderColor: "var(--border)",
          borderTopColor: "transparent",
        }}
        role="status"
        aria-label={label ?? "Loading"}
      />
      {label && (
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      )}
    </div>
  );
}
