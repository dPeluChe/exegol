import type { PipelineRun, PipelineStepResult, PipelineTemplate } from "@exegol/shared";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import { getPipelineRun, updatePipelineRun } from "../db/queries";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { attachStepScore, summarizeStepDiff } from "./evidence";
import { commitStepSnapshot } from "./oplog-snapshots";
import { captureGitDiff, now, readScrollbackSummary } from "./pipeline-helpers";

export interface StepHandlerDeps {
  activeAgents: Map<string, string>;
  idleTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** T129 — prepared (uncommitted) oplog snapshot tree, keyed by agent id. */
  pendingSnapshots: Map<string, string>;
  advanceStep(
    db: Database.Database,
    runId: string,
    stepIndex: number,
    template: PipelineTemplate,
  ): Promise<void>;
  completeRun(db: Database.Database, run: PipelineRun): void;
  pauseRun(db: Database.Database, runId: string, reason?: string): void;
}

export async function handleStepComplete(
  deps: StepHandlerDeps,
  db: Database.Database,
  runId: string,
  stepIndex: number,
  agentId: string,
  exitCode: number,
  template: PipelineTemplate,
): Promise<void> {
  deps.activeAgents.delete(runId);
  const idleTimer = deps.idleTimers.get(agentId);
  if (idleTimer) {
    clearTimeout(idleTimer);
    deps.idleTimers.delete(agentId);
  }

  const run = getPipelineRun(db, runId);
  if (!run || run.status === "cancelled") return;

  const [outputSummary, diffSummary] = await Promise.all([
    readScrollbackSummary(agentId),
    run.worktreePath ? captureGitDiff(run.worktreePath) : Promise.resolve(""),
  ]);

  const stepDef = template.steps[stepIndex];
  // T130 — evidence: agent score attaches synchronously; the AI diff summary
  // is fire-and-forget (up to 20s of network) so it never delays advancing.
  const score = attachStepScore(db, agentId);

  const updatedResults = run.stepResults.map((r) =>
    r.agentId === agentId
      ? {
          ...r,
          status: (exitCode === 0 ? "completed" : "failed") as PipelineStepResult["status"],
          exitCode,
          outputSummary,
          diffSummary,
          score,
          completedAt: now(),
        }
      : r,
  );

  if (exitCode === 0) {
    // Patch aiSummary in later against a FRESH run read — the local snapshot
    // may be stale by the time the network call resolves (cancel, next step).
    summarizeStepDiff(db, diffSummary, stepDef?.label ?? "step")
      .then((aiSummary) => {
        if (!aiSummary) return;
        const fresh = getPipelineRun(db, runId);
        if (!fresh || fresh.status === "cancelled") return;
        const patched = fresh.stepResults.map((r) =>
          r.agentId === agentId ? { ...r, aiSummary } : r,
        );
        updatePipelineRun(db, runId, { stepResults: patched });
      })
      .catch((err) => logger.warn("[Pipeline] Evidence summary patch failed (non-fatal):", err));
  }

  const success = exitCode === 0;

  // T129: commit the prepared snapshot only on success — a failed turn
  // never lands on the hidden oplog chain (unmaterialized discard).
  const treeSha = deps.pendingSnapshots.get(agentId) ?? null;
  deps.pendingSnapshots.delete(agentId);
  if (success) {
    commitStepSnapshot(
      run.worktreePath,
      treeSha,
      agentId,
      stepDef?.cliType ?? "unknown",
      stepIndex,
      `${stepDef?.label ?? `step ${stepIndex}`} (run ${runId})`,
    );
  }

  if (success) {
    updatePipelineRun(db, runId, { stepResults: updatedResults });
    const nextIndex = stepIndex + 1;
    if (nextIndex >= template.steps.length) {
      deps.completeRun(db, { ...run, stepResults: updatedResults });
    } else {
      deps.advanceStep(db, runId, nextIndex, template).catch((err) => {
        logger.error("[Pipeline] Failed to advance step:", err);
        deps.pauseRun(db, runId, `Failed to advance: ${err}`);
      });
    }
  } else {
    const loopBackTo = stepDef?.loopBackTo;

    if (loopBackTo !== undefined && loopBackTo >= 0) {
      const iterCount = run.iterationCount + 1;

      if (iterCount >= run.maxIterations) {
        updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
        deps.pauseRun(db, runId, `Max iterations (${run.maxIterations}) reached`);
      } else {
        updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
        deps.advanceStep(db, runId, loopBackTo, template).catch((err) => {
          logger.error("[Pipeline] Failed to loop back:", err);
          deps.pauseRun(db, runId, `Failed to loop back: ${err}`);
        });
      }
    } else if (stepDef?.allowFailure) {
      updatePipelineRun(db, runId, { stepResults: updatedResults });
      const nextIndex = stepIndex + 1;
      if (nextIndex >= template.steps.length) {
        deps.completeRun(db, { ...run, stepResults: updatedResults });
      } else {
        deps.advanceStep(db, runId, nextIndex, template).catch((err) => {
          logger.error("[Pipeline] Failed to advance after allowFailure:", err);
          deps.pauseRun(db, runId, `Failed to advance: ${err}`);
        });
      }
    } else {
      updatePipelineRun(db, runId, { stepResults: updatedResults });
      deps.pauseRun(
        db,
        runId,
        `Step "${stepDef?.label ?? stepIndex}" failed with exit code ${exitCode}`,
      );
    }
  }
}

export function startIdleMonitor(
  idleTimers: Map<string, ReturnType<typeof setTimeout>>,
  agentId: string,
  idleSeconds: number,
): void {
  const timeoutMs = idleSeconds * 1000;
  const manager = getAgentManager();

  const resetTimer = (): void => {
    const existing = idleTimers.get(agentId);
    if (existing) clearTimeout(existing);
    idleTimers.set(
      agentId,
      setTimeout(() => {
        idleTimers.delete(agentId);
        unsubData();
        const ptyHost = getPtyHost();
        if (ptyHost.isAlive(agentId)) {
          logger.info(`[Pipeline] Auto-closing idle agent: ${agentId} (${idleSeconds}s timeout)`);
          ptyHost.kill(agentId);
        }
      }, timeoutMs),
    );
  };

  const unsubData = manager.onAgentData(agentId, () => resetTimer());
  resetTimer();
}
