import type { PipelineRun, PipelineStepResult, PipelineTemplate } from "@exegol/shared";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import { getPipelineRun, updatePipelineRun } from "../db/queries";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { attachStepScore, summarizeStepDiff } from "./evidence";
import { captureGitDiff, now, readScrollbackSummary } from "./pipeline-helpers";

export interface StepHandlerDeps {
  activeAgents: Map<string, string>;
  idleTimers: Map<string, ReturnType<typeof setTimeout>>;
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
  // T130 — evidence: AI diff summary + agent score. Both are best-effort
  // (never throw) and must not delay stepping on a failed step.
  const [aiSummary, score] = await Promise.all([
    exitCode === 0
      ? summarizeStepDiff(db, diffSummary, stepDef?.label ?? "step")
      : Promise.resolve(""),
    Promise.resolve(attachStepScore(db, agentId)),
  ]);

  const updatedResults = run.stepResults.map((r) =>
    r.agentId === agentId
      ? {
          ...r,
          status: (exitCode === 0 ? "completed" : "failed") as PipelineStepResult["status"],
          exitCode,
          outputSummary,
          diffSummary,
          aiSummary,
          score,
          completedAt: now(),
        }
      : r,
  );

  const success = exitCode === 0;

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
