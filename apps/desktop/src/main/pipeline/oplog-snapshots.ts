import type { OplogSnapshotOperation } from "@exegol/shared";
import { coreRust } from "../agents/spawn-env";
import { logger } from "../lib/logger";

/**
 * T129 — wires the GitButler-style hidden-ref oplog chain into pipeline
 * step boundaries (a step's agent exit is its boundary). Interactive agents'
 * hook turns commit here too, as "AgentTurn" (T200.5, agents/turn-snapshots.ts).
 *
 * Failures here are always swallowed — a broken snapshot must never break
 * pipeline execution, it just means that turn has no undo point.
 */

/** Build the in-memory snapshot tree before the step's agent spawns. */
export function prepareStepSnapshot(worktreePath: string | null): string | null {
  if (!worktreePath || !coreRust) return null;
  try {
    return coreRust.prepareTurnSnapshot(worktreePath).treeSha;
  } catch (err) {
    logger.warn("[Oplog] prepare_turn_snapshot failed (continuing without snapshot):", err);
    return null;
  }
}

/**
 * Commit a previously prepared tree onto the hidden oplog chain — call only
 * when the step's agent turn succeeded. On failure, the caller should just
 * drop the prepared tree sha; nothing is ever written to the chain.
 */
export function commitStepSnapshot(
  worktreePath: string | null,
  treeSha: string | null,
  agentId: string,
  provider: string,
  turnIndex: number,
  description: string,
  operation: OplogSnapshotOperation = "PipelineStep",
): string | null {
  if (!worktreePath || !treeSha || !coreRust) return null;
  try {
    return coreRust.commitTurnSnapshot(
      worktreePath,
      treeSha,
      operation,
      agentId,
      provider,
      turnIndex,
      description,
    ).sha;
  } catch (err) {
    logger.warn("[Oplog] commit_turn_snapshot failed:", err);
    return null;
  }
}
