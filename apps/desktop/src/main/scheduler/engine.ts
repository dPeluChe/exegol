import {
  DEFAULT_SCHEDULED_TIMEOUT_MINUTES,
  type ScheduledResultStatus,
  type ScheduledRun,
  type ScheduledTask,
} from "@exegol/shared";
import { Cron } from "croner";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import {
  closeScheduledRun,
  createAgent,
  getAgent,
  getOpenScheduledRun,
  getScheduledTask,
  getTokenUsageSummary,
  listQueuedScheduledRuns,
  listRunningScheduledRuns,
  listScheduledTasks,
  queueScheduledRun,
  recordScheduledResult,
  startScheduledRun,
  updateScheduledTask,
} from "../db/queries";
import { TimeoutError } from "../lib/errors";
import { logger } from "../lib/logger";

let instance: SchedulerEngine | null = null;

export function getSchedulerEngine(): SchedulerEngine {
  if (!instance) {
    instance = new SchedulerEngine();
  }
  return instance;
}

const DEFAULT_MAX_CONCURRENT = 3;
export const BUDGET_CHECK_MS = 30_000;

interface ActiveRun {
  runId: string;
  taskId: string;
  agentId: string;
  closed: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

type DependencyGate = { state: "ready" } | { state: "wait" | "blocked"; ids: string[] };

export class SchedulerEngine {
  private jobs: Map<string, Cron> = new Map();
  /** taskId → its running run. Holds the concurrency slot until the agent is really gone */
  private active: Map<string, ActiveRun> = new Map();
  private db: Database.Database | null = null;
  private maxConcurrent: number = DEFAULT_MAX_CONCURRENT;

  /** Load all enabled tasks from DB and create Cron jobs */
  start(db: Database.Database): void {
    this.db = db;
    this.loadMaxConcurrent(db);
    this.closeInterruptedRuns(db);
    const tasks = listScheduledTasks(db);
    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleJob(task.id, task.cronExpression);
      }
    }
    logger.info(
      `[Scheduler] Started with ${this.jobs.size} active jobs (max concurrent: ${this.maxConcurrent})`,
    );
    this.pump();
  }

  /** Stop all cron jobs. Running runs stay open; the next start closes them as interrupted */
  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
    for (const run of this.active.values()) this.clearTimers(run);
    this.active.clear();
    this.db = null;
    logger.info("[Scheduler] Stopped all jobs");
  }

  /** Create and register a new Cron job for a task */
  addTask(taskId: string, cronExpression: string): void {
    this.scheduleJob(taskId, cronExpression);
  }

  /** Stop and remove a job */
  removeTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.stop();
      this.jobs.delete(taskId);
    }
  }

  /** Pause a job without removing it */
  pauseTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.pause();
    }
  }

  /** Resume a paused job */
  resumeTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.resume();
    }
  }

  /** Queue an immediate run of a scheduled task */
  async runNow(taskId: string): Promise<void> {
    this.enqueue(taskId);
  }

  /** Update the max concurrent limit */
  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, value);
    this.pump();
  }

  private loadMaxConcurrent(db: Database.Database): void {
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("scheduler_max_concurrent") as { value: string } | undefined;
      if (row) {
        this.maxConcurrent = Math.max(1, Number.parseInt(row.value, 10));
      }
    } catch {
      // Use default
    }
  }

  private scheduleJob(taskId: string, cronExpression: string): void {
    // Stop existing job if any
    this.removeTask(taskId);

    // croner runs in local time by default; its `timezone` option rejects "local"
    const job = new Cron(cronExpression, () => {
      try {
        this.enqueue(taskId);
      } catch (err) {
        logger.error(`[Scheduler] Error queueing task ${taskId}:`, err);
      }
    });

    this.jobs.set(taskId, job);
    this.updateNextRun(taskId);
  }

  private updateNextRun(taskId: string): void {
    const nextRun = this.jobs.get(taskId)?.nextRun();
    if (this.db && nextRun) {
      updateScheduledTask(this.db, taskId, { nextRunAt: Math.floor(nextRun.getTime() / 1000) });
    }
  }

  /** A tick while the previous run is queued or running is dropped, never stacked */
  private enqueue(taskId: string): void {
    if (!this.db) return;
    const task = getScheduledTask(this.db, taskId);
    if (!task?.enabled) return;
    if (getOpenScheduledRun(this.db, taskId)) {
      logger.info(`[Scheduler] Task ${taskId} already has an open run, skipping this tick`);
      return;
    }
    queueScheduledRun(this.db, taskId);
    this.pump();
  }

  /** Starts queued runs, oldest first, while slots are free */
  private pump(): void {
    const db = this.db;
    if (!db) return;
    for (const run of listQueuedScheduledRuns(db)) {
      if (this.active.size >= this.maxConcurrent) {
        logger.info(`[Scheduler] Concurrency limit reached (${this.maxConcurrent}), runs deferred`);
        return;
      }
      if (this.active.has(run.taskId)) continue;
      const task = getScheduledTask(db, run.taskId);
      if (!task?.enabled) {
        closeScheduledRun(db, run.id, "skipped", "Task disabled before the run started");
        continue;
      }
      const gate = this.dependencyGate(task);
      if (gate.state === "wait") continue;
      if (gate.state === "blocked") {
        logger.info(`[Scheduler] Task ${task.id} blocked by dependencies: ${gate.ids.join(", ")}`);
        closeScheduledRun(db, run.id, "skipped", `Blocked by dependencies: ${gate.ids.join(", ")}`);
        continue;
      }
      try {
        this.startRun(db, run, task);
      } catch (err) {
        const summary = err instanceof Error ? err.message : "Unknown error";
        if (closeScheduledRun(db, run.id, "failure", summary)) {
          updateScheduledTask(db, task.id, { lastResultStatus: "failure" });
        }
        this.active.delete(task.id);
      }
    }
  }

  private startRun(db: Database.Database, run: ScheduledRun, task: ScheduledTask): void {
    logger.info(`[Scheduler] Executing task ${task.id} (run ${run.attempt})`);
    const skillNames = task.skillName ? [task.skillName] : undefined;
    const config = {
      projectId: task.projectId,
      cliType: task.cliAgent as Parameters<typeof createAgent>[1]["cliType"],
      taskDescription: task.prompt,
      skillNames,
    };
    const agent = createAgent(db, config);
    const active: ActiveRun = {
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      closed: false,
      timers: [],
    };
    this.active.set(task.id, active);
    startScheduledRun(db, run.id, agent.id);
    updateScheduledTask(db, task.id, { lastRunAt: Math.floor(Date.now() / 1000) });

    const minutes = task.timeoutMinutes ?? DEFAULT_SCHEDULED_TIMEOUT_MINUTES;
    active.timers.push(
      setTimeout(() => {
        const err = new TimeoutError(`Agent did not complete within ${minutes} minutes`);
        void this.abort(active, "timeout", err.message);
      }, minutes * 60_000),
    );
    const budget = task.maxTokenBudget;
    if (budget) {
      active.timers.push(
        setInterval(() => {
          if (!this.db) return;
          const usage = getTokenUsageSummary(this.db, agent.id, 0);
          const used = usage.totalInputTokens + usage.totalOutputTokens;
          if (used > budget) {
            void this.abort(active, "budget_exceeded", `Used ${used} tokens, budget ${budget}`);
          }
        }, BUDGET_CHECK_MS),
      );
    }

    const manager = getAgentManager();
    manager.onAgentComplete(agent.id, (exitCode) => {
      const status = exitCode === 0 ? "success" : "failure";
      const step = this.db ? getAgent(this.db, agent.id)?.currentStep : null;
      this.close(active, status, step ?? `Agent ${exitCode === 0 ? "completed" : "failed"}`);
      this.release(active);
    });
    manager.spawn(db, agent, config).catch((err: unknown) => {
      this.close(active, "failure", err instanceof Error ? err.message : "Unknown error");
      this.release(active);
    });
  }

  /** Records the result first, then ends the agent and what it started (PtyHost.kill reads its
   *  process tree); the slot frees only once that is done, so a hung run cannot overlap the next */
  private async abort(
    active: ActiveRun,
    status: ScheduledResultStatus,
    summary: string,
  ): Promise<void> {
    if (active.closed) return;
    logger.warn(`[Scheduler] Task ${active.taskId} run ended: ${status} (${summary})`);
    this.close(active, status, summary);
    try {
      if (this.db) await getAgentManager().stop(this.db, active.agentId);
    } catch (err) {
      logger.warn(`[Scheduler] Failed to stop agent ${active.agentId}:`, err);
    }
    this.release(active);
  }

  private close(active: ActiveRun, status: ScheduledResultStatus, summary: string): void {
    if (active.closed) return;
    active.closed = true;
    this.clearTimers(active);
    const db = this.db;
    if (!db || !closeScheduledRun(db, active.runId, status, summary)) return;
    recordScheduledResult(db, {
      taskId: active.taskId,
      agentId: active.agentId,
      status,
      summary,
    });
    updateScheduledTask(db, active.taskId, { lastResultStatus: status });
  }

  private release(active: ActiveRun): void {
    if (this.active.get(active.taskId) !== active) return;
    this.active.delete(active.taskId);
    this.updateNextRun(active.taskId);
    this.pump();
  }

  private clearTimers(active: ActiveRun): void {
    for (const t of active.timers) clearTimeout(t);
    active.timers = [];
  }

  /** A run left open by a quit has nobody waiting on it: close it so the task can run again */
  private closeInterruptedRuns(db: Database.Database): void {
    for (const run of listRunningScheduledRuns(db)) {
      const summary = "Interrupted: Exegol quit during the run";
      if (!closeScheduledRun(db, run.id, "failure", summary)) continue;
      if (run.agentId) {
        recordScheduledResult(db, {
          taskId: run.taskId,
          agentId: run.agentId,
          status: "failure",
          summary,
        });
      }
      updateScheduledTask(db, run.taskId, { lastResultStatus: "failure" });
    }
  }

  /**
   * Parse the depends_on field (comma-separated task IDs or JSON array).
   */
  private parseDependsOn(dependsOn: string): string[] {
    try {
      const parsed = JSON.parse(dependsOn);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — treat as comma-separated
    }
    return dependsOn
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** A dependency still queued or running makes the run wait; one whose last result is not a
   *  success (a timeout included) blocks it. Missing dependencies never block */
  private dependencyGate(task: ScheduledTask): DependencyGate {
    const db = this.db;
    if (!task.dependsOn || !db) return { state: "ready" };
    const waiting: string[] = [];
    const blocking: string[] = [];
    for (const depId of this.parseDependsOn(task.dependsOn)) {
      const depTask = getScheduledTask(db, depId);
      if (!depTask) continue;
      if (getOpenScheduledRun(db, depId)) waiting.push(depId);
      else if (depTask.lastResultStatus !== "success") blocking.push(depId);
    }
    if (waiting.length > 0) return { state: "wait", ids: waiting };
    if (blocking.length > 0) return { state: "blocked", ids: blocking };
    return { state: "ready" };
  }

  /**
   * Detect circular dependencies using DFS.
   * Returns true if adding dependsOn to taskId would create a cycle.
   */
  detectCycle(db: Database.Database, taskId: string, dependsOnIds: string[]): boolean {
    const visited = new Set<string>();

    const dfs = (currentId: string): boolean => {
      if (currentId === taskId) return true; // Cycle found
      if (visited.has(currentId)) return false;
      visited.add(currentId);

      const task = getScheduledTask(db, currentId);
      if (!task?.dependsOn) return false;

      const deps = this.parseDependsOn(task.dependsOn);
      return deps.some(dfs);
    };

    return dependsOnIds.some(dfs);
  }
}
