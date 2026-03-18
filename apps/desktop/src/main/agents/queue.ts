import type Database from "libsql";
import { createAgent } from "../db/queries";
import {
  countRunningQueueTasks,
  listQueuedTasks,
  unblockDependents,
  updateQueueTaskStatus,
} from "../db/queries/queue";
import { logger } from "../lib/logger";
import { getAgentManager } from "./manager";

const DEFAULT_MAX_CONCURRENT = 3;
const POLL_INTERVAL_MS = 5_000;
const SETTINGS_KEY = "queue_max_concurrent";

// ─── Queue Executor Singleton ───────────────────────────────────────────────

let instance: QueueExecutor | null = null;

export function getQueueExecutor(): QueueExecutor {
  if (!instance) {
    instance = new QueueExecutor();
  }
  return instance;
}

/**
 * QueueExecutor: polls the task_queue table and spawns agents for queued tasks.
 *
 * Inspired by:
 * - gstack's Conductor pattern: 10+ parallel sessions, state file tracking
 * - Stoneforge's dispatch daemon: 7-phase polling loop, concurrency guards
 * - DeerFlow's executor: MAX_CONCURRENT_SUBAGENTS = 3, separate scheduler/execution
 * - Mission Control's queue API: SELECT + conditional UPDATE retry loop
 */
export class QueueExecutor {
  private db: Database.Database | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private maxConcurrent: number = DEFAULT_MAX_CONCURRENT;

  /** Start the queue executor polling loop */
  start(db: Database.Database): void {
    this.db = db;
    this.loadMaxConcurrent(db);

    this.pollTimer = setInterval(() => {
      this.pollCycle().catch((err) => {
        logger.error("[QueueExecutor] Poll cycle error:", err);
      });
    }, POLL_INTERVAL_MS);

    logger.info(
      `[QueueExecutor] Started (max concurrent: ${this.maxConcurrent}, poll: ${POLL_INTERVAL_MS}ms)`,
    );
  }

  /** Stop the queue executor */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.db = null;
    logger.info("[QueueExecutor] Stopped");
  }

  /** Update concurrency limit */
  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, value);
  }

  /** Force an immediate poll */
  async pollNow(): Promise<void> {
    await this.pollCycle();
  }

  private loadMaxConcurrent(db: Database.Database): void {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as
        | { value: string }
        | undefined;
      if (row) {
        this.maxConcurrent = Math.max(1, Number.parseInt(row.value, 10));
      }
    } catch {
      // Use default
    }
  }

  /**
   * Main poll cycle — find queued tasks and spawn agents up to the concurrency limit.
   * Single-flight: if a poll is already in progress, skip this cycle.
   */
  private async pollCycle(): Promise<void> {
    if (!this.db || this.polling) return;
    this.polling = true;

    try {
      // Get all projects with queued tasks
      const allQueued = this.db
        .prepare("SELECT DISTINCT project_id FROM task_queue WHERE status = 'queued'")
        .all() as { project_id: string }[];

      for (const { project_id: projectId } of allQueued) {
        await this.processProjectQueue(projectId);
      }
    } catch (err) {
      logger.error("[QueueExecutor] Poll cycle failed:", err);
    } finally {
      this.polling = false;
    }
  }

  private async processProjectQueue(projectId: string): Promise<void> {
    if (!this.db) return;

    // Check concurrency limit per project
    const running = countRunningQueueTasks(this.db, projectId);
    if (running >= this.maxConcurrent) return;

    const available = this.maxConcurrent - running;
    const queued = listQueuedTasks(this.db, projectId);

    // Dispatch up to `available` tasks
    const toDispatch = queued.slice(0, available);

    for (const task of toDispatch) {
      // Check if dependency is satisfied
      if (task.dependsOn) {
        const dep = this.db
          .prepare("SELECT status FROM task_queue WHERE id = ?")
          .get(task.dependsOn) as { status: string } | undefined;
        if (!dep || dep.status !== "completed") {
          continue; // Still blocked
        }
      }

      await this.dispatchTask(task.id, projectId, task.prompt, task.cliType);
    }
  }

  private async dispatchTask(
    queueTaskId: string,
    projectId: string,
    prompt: string,
    cliType: string,
  ): Promise<void> {
    if (!this.db) return;

    logger.info(
      `[QueueExecutor] Dispatching queue task ${queueTaskId}: "${prompt.slice(0, 60)}..."`,
    );

    // Create agent record
    const agent = createAgent(this.db, {
      projectId,
      cliType: cliType as Parameters<typeof createAgent>[1]["cliType"],
      taskDescription: prompt,
    });

    // Mark queue task as running
    updateQueueTaskStatus(this.db, queueTaskId, "running", agent.id);

    try {
      const manager = getAgentManager();
      await manager.spawn(this.db, agent, {
        projectId,
        cliType: agent.cliType,
        taskDescription: prompt,
      });

      // Register completion callback
      manager.onAgentComplete(agent.id, (exitCode) => {
        if (!this.db) return;

        const status = exitCode === 0 ? "completed" : "failed";
        updateQueueTaskStatus(this.db, queueTaskId, status);

        if (status === "completed") {
          // Unblock dependent tasks
          unblockDependents(this.db, queueTaskId);
        }

        logger.info(`[QueueExecutor] Queue task ${queueTaskId} ${status} (exit: ${exitCode})`);
      });
    } catch (err) {
      updateQueueTaskStatus(this.db, queueTaskId, "failed");
      logger.error(`[QueueExecutor] Failed to dispatch queue task ${queueTaskId}:`, err);
    }
  }
}
