import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentCliType,
  PipelineRun,
  PipelineStatusEvent,
  PipelineStepResult,
  PipelineTemplate,
} from "@exegol/shared";
import { BrowserWindow } from "electron";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import { getProviderRegistry } from "../agents/registry";
import { coreRust, slugifyBranchName } from "../agents/spawn-env";
import { getPtyHost } from "../terminal/pty-host";

// Auto-approve flags per CLI — pipeline steps always run in full-auto mode
const YOLO_FLAGS: Record<string, string> = {
  "claude-code": "--dangerously-skip-permissions",
  codex: "--full-auto",
  aider: "--yes-always",
  goose: "--no-confirm",
  crush: "--yolo",
};

import { stripAnsi } from "../agents/status-parser";
import {
  createAgent,
  createPipelineRun,
  getPipelineRun,
  getPipelineTemplate,
  getProject,
  recoverStalePipelineRuns,
  updatePipelineRun,
} from "../db/queries";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { buildStepPrompt, getPreviousOutput } from "./context";

// ─── Git status check ─────────────────────────────────────────────────────

export interface GitSyncStatus {
  clean: boolean;
  uncommittedChanges: boolean;
  unpushedCommits: number;
  message: string;
}

export function checkGitSync(projectPath: string): Promise<GitSyncStatus> {
  return new Promise((resolve) => {
    // Check for uncommitted changes
    exec(
      "git status --porcelain",
      { cwd: projectPath, encoding: "utf-8", timeout: 5_000 },
      (err1, dirtyOut) => {
        const uncommitted = !err1 && dirtyOut.trim().length > 0;

        // Check for unpushed commits
        exec(
          "git rev-list @{u}..HEAD --count 2>/dev/null",
          { cwd: projectPath, encoding: "utf-8", timeout: 5_000 },
          (err2, aheadOut) => {
            const ahead = err2 ? 0 : Number.parseInt(aheadOut.trim(), 10) || 0;

            const issues: string[] = [];
            if (uncommitted) issues.push("uncommitted changes");
            if (ahead > 0) issues.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);

            resolve({
              clean: !uncommitted && ahead === 0,
              uncommittedChanges: uncommitted,
              unpushedCommits: ahead,
              message:
                issues.length > 0 ? `Warning: ${issues.join(" and ")}` : "Repository is up to date",
            });
          },
        );
      },
    );
  });
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let instance: PipelineExecutor | null = null;

export function getPipelineExecutor(): PipelineExecutor {
  if (!instance) {
    instance = new PipelineExecutor();
  }
  return instance;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function broadcastPipelineStatus(event: PipelineStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("pipeline:status-changed", event);
  }
}

async function captureGitDiff(worktreePath: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      "git diff HEAD",
      { cwd: worktreePath, encoding: "utf-8", timeout: 10_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve("(failed to capture git diff)");
        } else {
          resolve(stdout || "(no changes)");
        }
      },
    );
  });
}

async function readScrollbackSummary(agentId: string): Promise<string> {
  try {
    const scrollbackPath = getScrollbackPath(agentId);
    const raw = await readFile(scrollbackPath, "utf-8");
    // Strip ANSI only on the tail portion to avoid processing entire file
    const tail = raw.length > 2000 ? raw.slice(-2000) : raw;
    return stripAnsi(tail);
  } catch {
    return "(no scrollback)";
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── PipelineExecutor ──────────────────────────────────────────────────────

export class PipelineExecutor {
  /** Track which run's agent is currently active */
  private activeAgents: Map<string, string> = new Map(); // runId → agentId
  /** Idle timers for interactive CLIs in pipeline mode */
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // agentId → timer

  /**
   * Start a new pipeline run from a template.
   */
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

    // Create shared worktree for the entire pipeline (unless user opted out)
    let worktreePath: string | null = null;
    if (useWorktree && coreRust) {
      const project = getProject(db, projectId);
      if (project) {
        try {
          const branchName = `pipeline/${slugifyBranchName(task)}`;
          const wtName = branchName.replace(/\//g, "-");
          const projectSlug = project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
          const targetPath = join(homedir(), ".exegol", "pipelines", projectSlug, wtName);
          const wtInfo = coreRust.createWorktree(project.path, wtName, branchName, targetPath);
          worktreePath = wtInfo.path;
          logger.info("[Pipeline] Created shared worktree:", { path: worktreePath });
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

    // Start first step
    await this.advanceStep(db, run.id, 0, template);
    return getPipelineRun(db, run.id) ?? run;
  }

  /**
   * Advance to a specific step in the pipeline.
   */
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
      // All steps complete
      this.completeRun(db, run);
      return;
    }

    // Update run status
    const startedAt = run.startedAt ?? now();
    updatePipelineRun(db, runId, {
      status: "running",
      currentStepIndex: stepIndex,
      startedAt,
    });

    // Build step result record
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

    // Build prompt
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

    // Spawn agent — store the full prompt as taskDescription so buildShellCommand() can inject it
    const agent = createAgent(db, {
      projectId: run.projectId,
      cliType: stepDef.cliType as AgentCliType,
      taskDescription: prompt,
      cwdOverride: run.worktreePath ?? undefined,
    });

    stepResult.agentId = agent.id;

    // Update step results
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

    // Register completion callback
    const manager = getAgentManager();
    manager.onAgentComplete(agent.id, (exitCode) => {
      // biome-ignore lint/style/noNonNullAssertion: template is captured in closure scope
      this.onStepComplete(db, runId, stepIndex, agent.id, exitCode, template!);
    });

    // Pipeline steps always run in full-auto (YOLO) mode — inject flag temporarily
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
      this.onStepComplete(db, runId, stepIndex, agent.id, 1, template);
    } finally {
      // Remove temporarily injected YOLO flag
      if (addedYolo && provider) {
        provider.args = provider.args.filter((a) => a !== yoloFlag);
      }
    }

    // Start idle monitoring for interactive CLIs
    const idleSeconds = provider?.capabilities?.pipelineIdleCloseSeconds ?? 0;
    if (idleSeconds > 0) {
      this.startIdleMonitor(agent.id, idleSeconds, db);
    }
  }

  /**
   * Handle step completion.
   */
  private async onStepComplete(
    db: Database.Database,
    runId: string,
    stepIndex: number,
    agentId: string,
    exitCode: number,
    template: PipelineTemplate,
  ): Promise<void> {
    this.activeAgents.delete(runId);
    // Clean up idle monitor if running
    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }

    const run = getPipelineRun(db, runId);
    if (!run || run.status === "cancelled") return;

    // Capture context (async to avoid blocking main thread)
    const [outputSummary, diffSummary] = await Promise.all([
      readScrollbackSummary(agentId),
      run.worktreePath ? captureGitDiff(run.worktreePath) : Promise.resolve(""),
    ]);

    // Update step result
    const updatedResults = run.stepResults.map((r) =>
      r.agentId === agentId
        ? {
            ...r,
            status: (exitCode === 0 ? "completed" : "failed") as PipelineStepResult["status"],
            exitCode,
            outputSummary,
            diffSummary,
            completedAt: now(),
          }
        : r,
    );

    const stepDef = template.steps[stepIndex];
    const success = exitCode === 0;

    if (success) {
      updatePipelineRun(db, runId, { stepResults: updatedResults });
      // Move to next step
      const nextIndex = stepIndex + 1;
      if (nextIndex >= template.steps.length) {
        this.completeRun(db, { ...run, stepResults: updatedResults });
      } else {
        this.advanceStep(db, runId, nextIndex, template).catch((err) => {
          logger.error("[Pipeline] Failed to advance step:", err);
          this.pauseRun(db, runId, `Failed to advance: ${err}`);
        });
      }
    } else {
      // Failure handling
      const loopBackTo = stepDef?.loopBackTo;

      if (loopBackTo !== undefined && loopBackTo >= 0) {
        // Loop back if under max iterations
        const iterCount = run.iterationCount + 1;

        if (iterCount >= run.maxIterations) {
          // Single DB write: step results + iteration count together
          updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
          this.pauseRun(db, runId, `Max iterations (${run.maxIterations}) reached`);
        } else {
          updatePipelineRun(db, runId, { stepResults: updatedResults, iterationCount: iterCount });
          this.advanceStep(db, runId, loopBackTo, template).catch((err) => {
            logger.error("[Pipeline] Failed to loop back:", err);
            this.pauseRun(db, runId, `Failed to loop back: ${err}`);
          });
        }
      } else if (stepDef?.allowFailure) {
        updatePipelineRun(db, runId, { stepResults: updatedResults });
        // Skip to next step
        const nextIndex = stepIndex + 1;
        if (nextIndex >= template.steps.length) {
          this.completeRun(db, { ...run, stepResults: updatedResults });
        } else {
          this.advanceStep(db, runId, nextIndex, template).catch((err) => {
            logger.error("[Pipeline] Failed to advance after allowFailure:", err);
            this.pauseRun(db, runId, `Failed to advance: ${err}`);
          });
        }
      } else {
        updatePipelineRun(db, runId, { stepResults: updatedResults });
        // Hard failure — pause pipeline
        this.pauseRun(
          db,
          runId,
          `Step "${stepDef?.label ?? stepIndex}" failed with exit code ${exitCode}`,
        );
      }
    }
  }

  /**
   * Monitor PTY output idle time for interactive CLIs.
   * Resets timer on each output. Auto-kills agent after N seconds of silence.
   */
  private startIdleMonitor(agentId: string, idleSeconds: number, _db: Database.Database): void {
    const timeoutMs = idleSeconds * 1000;
    const manager = getAgentManager();

    const resetTimer = (): void => {
      const existing = this.idleTimers.get(agentId);
      if (existing) clearTimeout(existing);
      this.idleTimers.set(
        agentId,
        setTimeout(() => {
          this.idleTimers.delete(agentId);
          unsubData();
          const ptyHost = getPtyHost();
          if (ptyHost.isAlive(agentId)) {
            logger.info(`[Pipeline] Auto-closing idle agent: ${agentId} (${idleSeconds}s timeout)`);
            ptyHost.kill(agentId);
          }
        }, timeoutMs),
      );
    };

    // Subscribe to agent data — reset idle timer on each PTY output
    const unsubData = manager.onAgentData(agentId, () => resetTimer());
    resetTimer();
  }

  /**
   * Mark the run as completed.
   */
  private completeRun(db: Database.Database, run: PipelineRun): void {
    updatePipelineRun(db, run.id, {
      status: "completed",
      completedAt: now(),
    });

    // Cleanup worktree if clean (dirty worktrees preserved for user commit/push)
    this.cleanupWorktree(db, run);

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

  private cleanupWorktree(db: Database.Database, run: PipelineRun): void {
    if (!run.worktreePath || !coreRust) return;
    try {
      const hasChanges = coreRust.worktreeHasChanges(run.worktreePath);
      if (hasChanges) {
        logger.info("[Pipeline] Worktree has changes — keeping for manual review:", {
          path: run.worktreePath,
        });
        return;
      }
      const project = getProject(db, run.projectId);
      if (project) {
        const wtName = run.worktreePath.split("/").pop() ?? "";
        coreRust.removeWorktree(project.path, wtName, false);
        logger.info("[Pipeline] Cleaned up worktree after completion");
      }
    } catch {
      /* Non-fatal */
    }
  }

  /**
   * Pause a running pipeline.
   */
  pauseRun(db: Database.Database, runId: string, reason?: string): void {
    const run = getPipelineRun(db, runId);
    if (!run) return;

    // Stop current agent if active
    const activeAgentId = this.activeAgents.get(runId);
    if (activeAgentId) {
      const manager = getAgentManager();
      manager.stop(db, activeAgentId).catch(() => {});
      this.activeAgents.delete(runId);
    }

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

  /**
   * Resume a paused pipeline from current step.
   */
  async resumeRun(db: Database.Database, runId: string): Promise<void> {
    const run = getPipelineRun(db, runId);
    if (!run || run.status !== "paused") {
      throw new Error(`Pipeline run ${runId} is not paused`);
    }

    const template = getPipelineTemplate(db, run.templateId);
    if (!template) throw new Error(`Pipeline template ${run.templateId} not found`);

    await this.advanceStep(db, runId, run.currentStepIndex, template);
  }

  /**
   * Cancel a pipeline run.
   */
  async cancelRun(db: Database.Database, runId: string): Promise<void> {
    const run = getPipelineRun(db, runId);
    if (!run) return;

    // Stop current agent
    const activeAgentId = this.activeAgents.get(runId);
    if (activeAgentId) {
      const manager = getAgentManager();
      await manager.stop(db, activeAgentId);
      this.activeAgents.delete(runId);
    }

    // Mark remaining steps as skipped
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

    this.cleanupWorktree(db, run);

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

  /**
   * Recover stale pipeline runs on startup.
   */
  recoverOnStartup(db: Database.Database): void {
    const count = recoverStalePipelineRuns(db);
    if (count > 0) {
      logger.info(`[Pipeline] Recovered ${count} stale pipeline runs (set to paused)`);
    }
  }
}
