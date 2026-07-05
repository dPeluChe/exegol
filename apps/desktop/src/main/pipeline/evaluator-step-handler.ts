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
// Consecutive gate→gate ship hops per run. Two gates pointing onPassNext at
// each other would otherwise loop forever, burning N×2 judge calls per hop.
const shipHops = new Map<string, number>();

export function clearEvaluatorHops(runId: string): void {
  shipHops.delete(runId);
}

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

  const preRun = getPipelineRun(db, runId);
  if (!preRun || preRun.status === "cancelled") return;

  const hops = (shipHops.get(runId) ?? 0) + 1;
  shipHops.set(runId, hops);
  if (hops > template.steps.length) {
    shipHops.delete(runId);
    deps.pauseRun(db, runId, "Evaluator gate cycle detected (gates routing to each other)");
    return;
  }

  // Resume-after-hold = human approval: the run was paused for review at this
  // gate; re-judging the identical diff would statistically hold again forever.
  const heldBefore = preRun.stepResults.some(
    (r) => r.stepIndex === stepIndex && r.verdict?.decision === "hold",
  );

  // Nothing to judge (no worktree / empty diff): adversarial judges score an
  // empty diff near 0 → guaranteed retry loop. Hold with an explicit reason.
  const hasRealDiff = diff.trim().length > 0 && !diff.trim().startsWith("(");

  const apiKey = getApiKey(db, "anthropic");
  const verdict = heldBefore
    ? {
        decision: "ship" as const,
        scores: [],
        avgScore: 0,
        feedback: "Resumed after hold — treated as human-approved.",
        costUsd: 0,
      }
    : !hasRealDiff
      ? {
          decision: "hold" as const,
          scores: [],
          avgScore: 0,
          feedback: "No diff to judge (run has no worktree or no changes) — review manually.",
          costUsd: 0,
        }
      : await runEvaluatorGate(apiKey, diff, evalDef.acceptanceCriteria, {
          judgeCalls: evalDef.judgeCalls,
          gatePolicy: evalDef.gatePolicy,
        });

  // Re-fetch after the (up to ~60s) judge await: the user may have cancelled,
  // and completing/routing from the stale snapshot would bypass T78 guards.
  const run = getPipelineRun(db, runId);
  if (!run || run.status === "cancelled") return;

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
      shipHops.delete(runId);
      deps.completeRun(db, { ...run, stepResults: updatedResults });
    } else {
      // Only gate→gate hops count toward the cycle guard.
      if (!template.steps[nextIndex]?.evaluator) shipHops.delete(runId);
      deps.advanceStep(db, runId, nextIndex, template).catch((err) => {
        logger.error("[Pipeline] Failed to advance after evaluator ship:", err);
        deps.pauseRun(db, runId, `Failed to advance: ${err}`);
      });
    }
    return;
  }

  if (verdict.decision === "hold") {
    shipHops.delete(runId);
    updatePipelineRun(db, runId, { stepResults: updatedResults });
    deps.pauseRun(
      db,
      runId,
      verdict.feedback ||
        `Evaluator gate: hold (avg score ${verdict.avgScore.toFixed(2)}) — needs human review`,
    );
    return;
  }

  shipHops.delete(runId);

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
