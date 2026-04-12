import type {
  AgentCliType,
  PipelineRun,
  PipelineStepResult,
  PipelineTemplate,
} from "@exegol/shared";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import { getProviderRegistry } from "../agents/registry";
import { coreRust, slugifyBranchName } from "../agents/spawn-env";
import { createManagedWorktree } from "../agents/worktrees";
import {
  createAgent,
  createPipelineRun,
  getPipelineRun,
  getPipelineTemplate,
  getProject,
  recoverStalePipelineRuns,
  updatePipelineRun,
} from "../db/queries";
import { runSetupHook } from "../hooks/project-hooks";
import { logger } from "../lib/logger";
import { buildStepPrompt, getPreviousOutput } from "./context";
import { broadcastPipelineStatus, captureGitDiff, now, YOLO_FLAGS } from "./pipeline-helpers";
import { assertTransition } from "./state-machine";
import {
  handleStepComplete,
  type StepHandlerDeps,
  startIdleMonitor,
} from "./pipeline-step-handler";
import { cleanupPipelineWorktree } from "./pipeline-worktree";

export { checkGitSync, type GitSyncStatus } from "./pipeline-helpers";

// ─── Singleton ─────────────────────────────────────────────────────────────

let instance: PipelineExecutor | null = null;

export function getPipelineExecutor(): PipelineExecutor {
  if (!instance) {
    instance = new PipelineExecutor();
  }
  return instance;
}

// ─── PipelineExecutor ──────────────────────────────────────────────────────

export class PipelineExecutor {
  private activeAgents: Map<string, string> = new Map();
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private getStepDeps(): StepHandlerDeps {
    return {
      activeAgents: this.activeAgents,
      idleTimers: this.idleTimers,
      advanceStep: (db, runId, stepIndex, template) =>
        this.advanceStep(db, runId, stepIndex, template),
      completeRun: (db, run) => this.completeRun(db, run),
      pauseRun: (db, runId, reason) => this.pauseRun(db, runId, reason),
    };
  }

  async startRun(
    db: Database.Database,
    templateId: string,
    projectId: string,
    task: string,
    maxIterations = 5,
    useWorktree = true,
  ): Promise<PipelineRun> {
    const template = getPipelineTemplate(db, templateId);
    if (!template) throw new Error(`Pipeline template ${templateId} not found`);

    let worktreePath: string | null = null;
    if (useWorktree && coreRust) {
      const project = getProject(db, projectId);
      if (project) {
        try {
          const branchName = `pipeline/${slugifyBranchName(task)}`;
          const wtInfo = createManagedWorktree(project.path, project.name, branchName, "pipelines");
          worktreePath = wtInfo.path;
          logger.info("[Pipeline] Created shared worktree:", { path: worktreePath });
          runSetupHook(project.path, worktreePath, wtInfo.branchName).catch(() => {});
        } catch (err) {
          logger.warn("[Pipeline] Failed to create worktree, using project root:", err);
        }
      }
    }

    const run = createPipelineRun(db, {
      templateId,
      projectId,
      originalTask: task,
      maxIterations,
      worktreePath,
    });

    logger.info("[Pipeline] Starting run:", { runId: run.id, template: template.name });

    await this.advanceStep(db, run.id, 0, template);
    return getPipelineRun(db, run.id) ?? run;
  }

  async advanceStep(
    db: Database.Database,
    runId: string,
    stepIndex: number,
    template?: PipelineTemplate,
  ): Promise<void> {
    const run = getPipelineRun(db, runId);
    if (!run) throw new Error(`Pipeline run ${runId} not found`);

    if (!template) {
      template = getPipelineTemplate(db, run.templateId) ?? undefined;
      if (!template) throw new Error(`Pipeline template ${run.templateId} not found`);
    }

    const stepDef = template.steps[stepIndex];
    if (!stepDef) {
      this.completeRun(db, run);
      return;
    }

    const startedAt = run.startedAt ?? now();
    if (!assertTransition(run.status, "running")) return;
    updatePipelineRun(db, runId, {
      status: "running",
      currentStepIndex: stepIndex,
      startedAt,
    });

    const stepResult: PipelineStepResult = {
      stepIndex,
      iteration: run.iterationCount,
      agentId: null,
      status: "running",
      exitCode: null,
      outputSummary: "",
      diffSummary: "",
      startedAt: now(),
      completedAt: null,
    };

    const diff = run.worktreePath ? await captureGitDiff(run.worktreePath) : "";
    const previousOutput = getPreviousOutput(run.stepResults);
    const isLastStep = stepIndex === template.steps.length - 1;
    const prompt = buildStepPrompt(stepDef, {
      task: run.originalTask,
      diff,
      previousOutput,
      iteration: run.iterationCount,
      isLastStep,
    });

    const agent = createAgent(db, {
      projectId: run.projectId,
      cliType: stepDef.cliType as AgentCliType,
      taskDescription: prompt,
      cwdOverride: run.worktreePath ?? undefined,
    });

    stepResult.agentId = agent.id;

    const updatedResults = [...run.stepResults, stepResult];
    updatePipelineRun(db, runId, { stepResults: updatedResults });

    this.activeAgents.set(runId, agent.id);

    broadcastPipelineStatus({
      runId,
      projectId: run.projectId,
      status: "running",
      currentStepIndex: stepIndex,
      stepLabel: stepDef.label,
      timestamp: Date.now(),
    });

    const manager = getAgentManager();
    manager.onAgentComplete(agent.id, (exitCode) => {
      // biome-ignore lint/style/noNonNullAssertion: template is captured in closure scope
      handleStepComplete(this.getStepDeps(), db, runId, stepIndex, agent.id, exitCode, template!);
    });

    const registry = getProviderRegistry();
    const provider = registry.get(stepDef.cliType);
    const yoloFlag = YOLO_FLAGS[stepDef.cliType];
    const addedYolo = yoloFlag && provider && !provider.args.includes(yoloFlag);
    if (addedYolo && provider) provider.args.push(yoloFlag);

    try {
      await manager.spawn(db, agent, {
        projectId: run.projectId,
        cliType: stepDef.cliType as AgentCliType,
        taskDescription: prompt,
        cwdOverride: run.worktreePath ?? undefined,
      });
    } catch (err) {
      logger.error("[Pipeline] Failed to spawn agent for step:", err);
      handleStepComplete(this.getStepDeps(), db, runId, stepIndex, agent.id, 1, template);
    } finally {
      if (addedYolo && provider) {
        provider.args = provider.args.filter((a) => a !== yoloFlag);
      }
    }

    const idleSeconds = provider?.capabilities?.pipelineIdleCloseSeconds ?? 0;
    if (idleSeconds > 0) {
      startIdleMonitor(this.idleTimers, agent.id, idleSeconds);
    }
  }

  private completeRun(db: Database.Database, run: PipelineRun): void {
    if (!assertTransition(run.status, "completed")) return;
    updatePipelineRun(db, run.id, {
      status: "completed",
      completedAt: now(),
    });

    cleanupPipelineWorktree(db, run);

    broadcastPipelineStatus({
      runId: run.id,
      projectId: run.projectId,
      status: "completed",
      currentStepIndex: run.currentStepIndex,
      stepLabel: null,
      timestamp: Date.now(),
    });

    logger.info("[Pipeline] Run completed:", { runId: run.id });
  }

  pauseRun(db: Database.Database, runId: string, reason?: string): void {
    const run = getPipelineRun(db, runId);
    if (!run) return;

    const activeAgentId = this.activeAgents.get(runId);
    if (activeAgentId) {
      const manager = getAgentManager();
      manager.stop(db, activeAgentId).catch(() => {});
      this.activeAgents.delete(runId);
    }

    if (!assertTransition(run.status, "paused")) return;
    updatePipelineRun(db, runId, { status: "paused" });

    broadcastPipelineStatus({
      runId,
      projectId: run.projectId,
      status: "paused",
      currentStepIndex: run.currentStepIndex,
      stepLabel: reason ?? null,
      timestamp: Date.now(),
    });

    logger.info("[Pipeline] Run paused:", { runId, reason });
  }

  async resumeRun(db: Database.Database, runId: string): Promise<void> {
    const run = getPipelineRun(db, runId);
    if (!run || run.status !== "paused") {
      throw new Error(`Pipeline run ${runId} is not paused`);
    }

    const template = getPipelineTemplate(db, run.templateId);
    if (!template) throw new Error(`Pipeline template ${run.templateId} not found`);

    await this.advanceStep(db, runId, run.currentStepIndex, template);
  }

  async cancelRun(db: Database.Database, runId: string): Promise<void> {
    const run = getPipelineRun(db, runId);
    if (!run) return;

    const activeAgentId = this.activeAgents.get(runId);
    if (activeAgentId) {
      const manager = getAgentManager();
      await manager.stop(db, activeAgentId);
      this.activeAgents.delete(runId);
    }

    if (!assertTransition(run.status, "cancelled")) return;

    const updatedResults = run.stepResults.map((r) =>
      r.status === "pending" || r.status === "running"
        ? { ...r, status: "skipped" as const, completedAt: now() }
        : r,
    );

    updatePipelineRun(db, runId, {
      status: "cancelled",
      stepResults: updatedResults,
      completedAt: now(),
    });

    cleanupPipelineWorktree(db, run);

    broadcastPipelineStatus({
      runId,
      projectId: run.projectId,
      status: "cancelled",
      currentStepIndex: run.currentStepIndex,
      stepLabel: null,
      timestamp: Date.now(),
    });

    logger.info("[Pipeline] Run cancelled:", { runId });
  }

  recoverOnStartup(db: Database.Database): void {
    const count = recoverStalePipelineRuns(db);
    if (count > 0) {
      logger.info(`[Pipeline] Recovered ${count} stale pipeline runs (set to paused)`);
    }
  }
}
