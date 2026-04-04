import type { PipelineRunStatus } from "@exegol/shared";

// ─── Allowed pipeline state transitions ────────────────────────────────────────

const TERMINAL_STATES = new Set<PipelineRunStatus>(["completed", "failed", "cancelled"]);

const TRANSITIONS: Record<PipelineRunStatus, PipelineRunStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isValidTransition(from: PipelineRunStatus, to: PipelineRunStatus): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function attemptTransition(
  current: PipelineRunStatus,
  target: PipelineRunStatus,
  runId?: string,
): PipelineRunStatus {
  if (isValidTransition(current, target)) return target;
  if (runId) {
    console.warn(`[Pipeline] Invalid transition: ${current} → ${target} (run: ${runId})`);
  }
  return current;
}
