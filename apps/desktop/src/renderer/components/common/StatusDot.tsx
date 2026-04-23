import type { AgentActivityLevel, AgentStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";

interface StatusDotProps {
  status: AgentStatus;
  /** T70: Optional activity level for richer visual feedback */
  activityLevel?: AgentActivityLevel;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  className?: string;
}

const STATUS_COLORS: Record<AgentStatus, { color: string; defaultPulse: boolean }> = {
  running: { color: "var(--success)", defaultPulse: true },
  waiting_input: { color: "var(--warning)", defaultPulse: true },
  spawning: { color: "var(--info)", defaultPulse: true },
  completed: { color: "var(--success)", defaultPulse: false },
  failed: { color: "var(--error)", defaultPulse: false },
  stopped: { color: "var(--text-muted)", defaultPulse: false },
  crashed: { color: "var(--error)", defaultPulse: false },
  idle: { color: "var(--text-muted)", defaultPulse: false },
  paused: { color: "var(--text-muted)", defaultPulse: false },
};

const SIZE_CLASSES = {
  sm: "h-1.5 w-1.5",
  md: "h-2.5 w-2.5",
  lg: "h-3.5 w-3.5",
} as const;

export function StatusDot({ status, activityLevel, size = "md", pulse, className }: StatusDotProps) {
  const config = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
  // T70: Activity-aware pulse — busy always pulses, idle slows/stops
  const shouldPulse = pulse ?? (activityLevel === "idle" ? false : config.defaultPulse);

  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full",
        SIZE_CLASSES[size],
        shouldPulse && "animate-status-pulse",
        className,
      )}
      style={{ background: config.color }}
      role="status"
      aria-label={status}
    />
  );
}
