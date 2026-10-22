import type { AgentStatus } from "@exegol/shared";
import type Database from "libsql";
import { updateAgentStatus, updateAgentStepIfStatus } from "../db/queries/agents";

/** The parser reports a step on every redraw: a step alone is written at most this often per
 *  agent, and the last one always lands */
export const STEP_WRITE_MS = 1000;

interface Written {
  status: AgentStatus;
  at: number;
  pending?: { step: string; timer: ReturnType<typeof setTimeout> };
}

const written = new Map<string, Written>();

function dropPending(entry: Written | undefined): void {
  if (!entry?.pending) return;
  clearTimeout(entry.pending.timer);
  entry.pending = undefined;
}

function flushStep(db: Database.Database, id: string): void {
  const entry = written.get(id);
  const step = entry?.pending?.step;
  if (!entry || step === undefined) return;
  entry.pending = undefined;
  try {
    if (updateAgentStepIfStatus(db, id, entry.status, step)) entry.at = Date.now();
  } catch {
    // DB closed during shutdown: the step is cosmetic
  }
}

/** The output path's status and step. The SQL skips an unchanged pair; here a step alone is
 *  throttled to one write per STEP_WRITE_MS */
export function writeAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  step?: string,
): void {
  const last = written.get(id);
  const now = Date.now();
  if (!last || last.status !== status || step === undefined) {
    const nextStep = step ?? last?.pending?.step;
    dropPending(last);
    const changed = updateAgentStatus(db, id, status, nextStep);
    const at = changed ? now : (last?.at ?? 0);
    written.set(id, { status, at });
    return;
  }
  if (last.pending) {
    last.pending.step = step;
    return;
  }
  const wait = STEP_WRITE_MS - (now - last.at);
  if (wait <= 0) {
    if (updateAgentStatus(db, id, status, step)) last.at = now;
    return;
  }
  const timer = setTimeout(() => flushStep(db, id), wait);
  timer.unref?.();
  last.pending = { step, timer };
}

/** Drop the pending step: the output pipeline is gone, or another writer set the step */
export function forgetAgentStatusWrites(id: string): void {
  dropPending(written.get(id));
  written.delete(id);
}
