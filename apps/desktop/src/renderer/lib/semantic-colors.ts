/**
 * Semantic color mappings using CSS variables from globals.css.
 * Use these instead of hardcoded Tailwind colors for consistency across themes.
 */

// ─── Agent status colors (background dot) ───────────────────────────────────

export const STATUS_DOT_COLORS: Record<string, string> = {
  running: "bg-success",
  spawning: "bg-info",
  waiting_input: "bg-warning",
  paused: "bg-text-muted",
  completed: "bg-success",
  failed: "bg-error",
  stopped: "bg-text-muted",
  crashed: "bg-error",
  idle: "bg-text-muted",
};

// ─── Semantic badge colors (bg + text pairs) ────────────────────────────────

export const SEMANTIC_BADGE = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  info: "bg-info/15 text-info",
  muted: "bg-text-muted/15 text-text-muted",
} as const;

// ─── Status → semantic mapping ──────────────────────────────────────────────

export function statusToSemantic(status: string): keyof typeof SEMANTIC_BADGE {
  switch (status) {
    case "running":
    case "completed":
    case "success":
      return "success";
    case "spawning":
    case "queued":
    case "info":
      return "info";
    case "waiting_input":
    case "paused":
    case "warning":
    case "timeout":
    case "blocked":
      return "warning";
    case "failed":
    case "crashed":
    case "error":
      return "error";
    default:
      return "muted";
  }
}
