import type { PipelineRunStatus } from "@exegol/shared";
import { logger } from "../lib/logger";

// ─── Allowed State Transitions ─────────────────────────────────────────────

const PIPELINE_TRANSITIONS: Record<PipelineRunStatus, readonly PipelineRunStatus[]> = {
  pending: ["running"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: PipelineRunStatus, to: PipelineRunStatus): boolean {
  return PIPELINE_TRANSITIONS[from].includes(to);
}

/**
 * Logs a warning if the transition is invalid. Does not throw.
 * Returns true if the transition is allowed, false otherwise.
 */
export function assertTransition(from: PipelineRunStatus, to: PipelineRunStatus): boolean {
  if (canTransition(from, to)) return true;
  logger.warn(`[Pipeline] Invalid state transition: ${from} → ${to} (skipped)`);
  return false;
}
