import { Cron } from "croner";
import type Database from "libsql";
import { getAgentManager } from "../agents/manager";
import {
  createAgent,
  getAgent,
  getScheduledTask,
  listScheduledTasks,
  recordScheduledResult,
  updateScheduledTask,
} from "../db/queries";
import { logger } from "../lib/logger";

let instance: SchedulerEngine | null = null;

export function getSchedulerEngine(): SchedulerEngine {
  if (!instance) {
    instance = new SchedulerEngine();
  }
  return instance;
}

const MAX_WAIT_MS = 10 * 60_000; // 10 minutes
const LOG_PROMPT_TRUNCATE_LENGTH = 60;

export class SchedulerEngine {
  private jobs: Map<string, Cron> = new Map();
  private runningTasks: Set<string> = new Set();
  private db: Database.Database | null = null;

  /** Load all enabled tasks from DB and create Cron jobs */
  start(db: Database.Database): void {
    this.db = db;
    const tasks = listScheduledTasks(db);
    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleJob(task.id, task.cronExpression);
      }
    }
    logger.info(`[Scheduler] Started with ${this.jobs.size} active jobs`);
  }

  /** Stop all cron jobs */
  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
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

  /** Trigger immediate execution of a scheduled task */
  async runNow(taskId: string): Promise<void> {
    await this.executeTask(taskId);
  }

  private scheduleJob(taskId: string, cronExpression: string): void {
    // Stop existing job if any
    this.removeTask(taskId);

    const job = new Cron(cronExpression, { timezone: "local" }, () => {
      this.executeTask(taskId).catch((err) => {
        logger.error(`[Scheduler] Error executing task ${taskId}:`, err);
      });
    });

    this.jobs.set(taskId, job);

    // Update next_run_at in DB
    if (this.db) {
      const nextRun = job.nextRun();
      if (nextRun) {
        updateScheduledTask(this.db, taskId, {
          nextRunAt: Math.floor(nextRun.getTime() / 1000),
        });
      }
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    if (!this.db) return;

    // Prevent concurrent executions of the same task
    if (this.runningTasks.has(taskId)) {
      logger.info(`[Scheduler] Task ${taskId} already running, skipping`);
      return;
    }

    const task = getScheduledTask(this.db, taskId);
    if (!task || !task.enabled) return;

    this.runningTasks.add(taskId);
    logger.info(
      `[Scheduler] Executing task ${taskId}: "${task.prompt.slice(0, LOG_PROMPT_TRUNCATE_LENGTH)}..."`,
    );

    // Create an agent to run this task
    const agent = createAgent(this.db, {
      projectId: task.projectId,
      cliType: task.cliAgent as Parameters<typeof createAgent>[1]["cliType"],
      taskDescription: task.prompt,
    });

    // Update last_run_at
    const now = Math.floor(Date.now() / 1000);
    updateScheduledTask(this.db, taskId, { lastRunAt: now });

    try {
      const manager = getAgentManager();
      await manager.spawn(this.db, agent, {
        projectId: task.projectId,
        cliType: agent.cliType,
        taskDescription: task.prompt,
      });

      // Poll agent status every 5s until completion
      await this.waitForCompletion(agent.id, taskId);
    } catch (err) {
      // Record failure
      recordScheduledResult(this.db, {
        taskId,
        agentId: agent.id,
        status: "failure",
        summary: err instanceof Error ? err.message : "Unknown error",
      });
      updateScheduledTask(this.db, taskId, { lastResultStatus: "failure" });
    }

    this.runningTasks.delete(taskId);

    // Update next_run_at
    const job = this.jobs.get(taskId);
    if (job) {
      const nextRun = job.nextRun();
      if (nextRun) {
        updateScheduledTask(this.db, taskId, {
          nextRunAt: Math.floor(nextRun.getTime() / 1000),
        });
      }
    }
  }

  private waitForCompletion(agentId: string, taskId: string): Promise<void> {
    const manager = getAgentManager();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.db) {
          recordScheduledResult(this.db, {
            taskId,
            agentId,
            status: "timeout",
            summary: "Agent did not complete within 10 minutes",
          });
          updateScheduledTask(this.db, taskId, { lastResultStatus: "timeout" });
        }
        resolve();
      }, MAX_WAIT_MS);

      manager.onAgentComplete(agentId, (exitCode) => {
        clearTimeout(timeout);

        if (!this.db) {
          resolve();
          return;
        }

        const agent = getAgent(this.db, agentId);
        const resultStatus = exitCode === 0 ? "success" : "failure";
        recordScheduledResult(this.db, {
          taskId,
          agentId,
          status: resultStatus,
          summary: agent?.currentStep ?? `Agent ${exitCode === 0 ? "completed" : "failed"}`,
        });
        updateScheduledTask(this.db, taskId, { lastResultStatus: resultStatus });
        resolve();
      });
    });
  }
}
