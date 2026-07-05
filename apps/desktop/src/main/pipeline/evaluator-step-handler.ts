import type { PipelineStepDef, PipelineStepResult, PipelineTemplate } from "@exegol/shared";
import { EVALUATOR_HARD_MAX_LOOPS } from "@exegol/shared";
import type Database from "libsql";
import { getPipelineRun, updatePipelineRun } from "../db/queries";
import { logger } from "../lib/logger";
import { getApiKey } from "../security/keystore";
import { runEvaluatorGate } from "./evaluator";
import { now } from "./pipeline-helpers";
import type { StepHandlerDeps } from "./pipeline-step-handler";

/**
 * T88v2 — routes an evaluator-gate step's decision (ship/hold/retry). Unlike
 * `handleStepComplete`, there is no spawned agent or exit-code callback: the
 * judge call resolves synchronously within `advanceStep`, so this appends
 * the step result and routes in one pass.
 */
export async function handleEvaluatorStep(
  deps: StepHandlerDeps,
  db: Database.Database,
  runId: string,
  stepIndex: number,
  stepDef: PipelineStepDef,
  template: PipelineTemplate,
  diff: string,
): Promise<void> {
  const evalDef = stepDef.evaluator;
  if (!evalDef) return;

  const run = getPipelineRun(db, runId);
  if (!run || run.status === "cancelled") return;

  const apiKey = getApiKey(db, "anthropic");
  const verdict = await runEvaluatorGate(apiKey, diff, evalDef.acceptanceCriteria, {
    judgeCalls: evalDef.judgeCalls,
    gatePolicy: evalDef.gatePolicy,
  });

  const stepResult: PipelineStepResult = {
    stepIndex,
    iteration: run.iterationCount,
    agentId: null,
    status: verdict.decision === "retry" ? "failed" : "completed",
    exitCode: null,
    outputSummary:
      verdict.feedback ||
      `Evaluator: avg score ${verdict.avgScore.toFixed(2)} (${verdict.decision})`,
    diffSummary: diff,
    startedAt: now(),
    completedAt: now(),
    verdict,
  };
  const updatedResults = [...run.stepResults, stepResult];

  logger.info("[Pipeline] Evaluator gate decision:", {
    runId,
    stepIndex,
    decision: verdict.decision,
    avgScore: verdict.avgScore,
    scores: verdict.scores,
  });

  if (verdict.decision === "ship") {
    updatePipelineRun(db, runId, { stepResults: updatedResults });
    const nextIndex = evalDef.onPassNext ?? stepIndex + 1;
    if (nextIndex >= template.steps.length) {
      deps.completeRun(db, { ...run, stepResults: updatedResults });
    } else {
      deps.advanceStep(db, runId, nextIndex, template).catch((err) => {
        logger.error("[Pipeline] Failed to advance after evaluator ship:", err);
        deps.pauseRun(db, runId, `Failed to advance: ${err}`);
      });
    }
    return;
  }

  if (verdict.decision === "hold") {
    updatePipelineRun(db, runId, { stepResults: updatedResults });
    deps.pauseRun(
      db,
      runId,
      `Evaluator gate: hold (avg score ${verdict.avgScore.toFixed(2)}) — needs human review`,
    );
    return;
  }

  // retry
  const hardMax = Math.min(evalDef.maxLoops ?? EVALUATOR_HARD_MAX_LOOPS, EVALUATOR_HARD_MAX_LOOPS);
  const iterCount = run.iterationCount + 1;

  if (evalDef.onFailNext === undefined || iterCount >= hardMax) {
    updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
    deps.pauseRun(
      db,
      runId,
      iterCount >= hardMax
        ? `Evaluator gate: max loops (${hardMax}) reached`
        : "Evaluator gate: retry requested but no loop-back step configured",
    );
    return;
  }

  updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
  deps.advanceStep(db, runId, evalDef.onFailNext, template).catch((err) => {
    logger.error("[Pipeline] Failed to loop back after evaluator retry:", err);
    deps.pauseRun(db, runId, `Failed to loop back: ${err}`);
  });
}
