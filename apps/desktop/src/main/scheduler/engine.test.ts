import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const mgr = vi.hoisted(() => ({
  completions: new Map<string, (exitCode: number) => void>(),
  spawned: [] as Array<{ agentId: string; skillNames?: string[] }>,
  stopped: [] as string[],
  spawnError: null as Error | null,
}));

vi.mock("../agents/manager", () => ({
  getAgentManager: () => ({
    spawn: async (_db: unknown, agent: { id: string }, config: { skillNames?: string[] }) => {
      if (mgr.spawnError) throw mgr.spawnError;
      mgr.spawned.push({ agentId: agent.id, skillNames: config.skillNames });
    },
    onAgentComplete: (id: string, cb: (exitCode: number) => void) => mgr.completions.set(id, cb),
    stop: async (_db: unknown, id: string) => {
      mgr.stopped.push(id);
    },
  }),
}));

import { createScheduledTask, getScheduledTask, listScheduledResults } from "../db/queries";
import { BUDGET_CHECK_MS, SchedulerEngine } from "./engine";

let db: Database.Database;
let engine: SchedulerEngine;

const CRON = "0 0 1 1 *";

function addTask(extra: Partial<Parameters<typeof createScheduledTask>[1]> = {}) {
  return createScheduledTask(
    db,
    { projectId: "p1", prompt: "nightly", cronExpression: CRON, cliAgent: "claude-code", ...extra },
    null,
  );
}

function runs(taskId: string) {
  return db
    .prepare("SELECT state, agent_id, attempt FROM scheduled_runs WHERE task_id = ? ORDER BY rowid")
    .all(taskId) as Array<{ state: string; agent_id: string | null; attempt: number }>;
}

/** Lets the stop() promise in abort settle */
const flush = () => vi.advanceTimersByTimeAsync(0);

const finish = (agentId: string, exitCode = 0) => mgr.completions.get(agentId)?.(exitCode);

beforeEach(() => {
  vi.useFakeTimers();
  db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
  mgr.completions.clear();
  mgr.spawned = [];
  mgr.stopped = [];
  mgr.spawnError = null;
  engine = new SchedulerEngine();
  engine.start(db);
});

afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe("SchedulerEngine timeout", () => {
  it("times out a hung run once, stops its agent and ignores the late exit", async () => {
    const task = addTask({ timeoutMinutes: 5 });
    await engine.runNow(task.id);
    const agentId = mgr.spawned[0]?.agentId as string;

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mgr.stopped).toEqual([agentId]);
    expect(runs(task.id)[0]?.state).toBe("timeout");
    expect(getScheduledTask(db, task.id)?.lastResultStatus).toBe("timeout");

    finish(agentId, 0);
    const results = listScheduledResults(db, task.id);
    expect(results.map((r) => r.status)).toEqual(["timeout"]);
    expect(results[0]?.summary).toContain("5 minutes");
  });

  it("uses the 30 minute default when the task sets none", async () => {
    const task = addTask();
    await engine.runNow(task.id);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(mgr.stopped).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs(task.id)[0]?.state).toBe("timeout");
  });

  it("records a normal finish as success and clears the timeout", async () => {
    const task = addTask({ timeoutMinutes: 1, skillName: "review" });
    await engine.runNow(task.id);
    expect(mgr.spawned[0]?.skillNames).toEqual(["review"]);
    finish(mgr.spawned[0]?.agentId as string, 0);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(mgr.stopped).toEqual([]);
    expect(listScheduledResults(db, task.id).map((r) => r.status)).toEqual(["success"]);
  });

  it("records a spawn failure", async () => {
    mgr.spawnError = new Error("Preflight failed");
    const task = addTask();
    await engine.runNow(task.id);
    await flush();
    expect(runs(task.id)[0]?.state).toBe("failure");
    expect(listScheduledResults(db, task.id)[0]?.summary).toBe("Preflight failed");
  });
});

describe("SchedulerEngine overlap and capacity", () => {
  it("drops a tick while the same task still runs", async () => {
    const task = addTask();
    await engine.runNow(task.id);
    await engine.runNow(task.id);
    expect(mgr.spawned).toHaveLength(1);
    expect(runs(task.id)).toHaveLength(1);

    finish(mgr.spawned[0]?.agentId as string);
    await engine.runNow(task.id);
    expect(runs(task.id).map((r) => r.attempt)).toEqual([1, 2]);
  });

  it("fires on its cron and does not stack ticks on a hung run", async () => {
    const task = addTask({ cronExpression: "* * * * *" });
    engine.addTask(task.id, task.cronExpression);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(mgr.spawned).toHaveLength(1);
    expect(runs(task.id)).toHaveLength(1);
  });

  it("keeps a run queued while slots are full and starts it when one frees", async () => {
    engine.setMaxConcurrent(1);
    const a = addTask();
    const b = addTask();
    await engine.runNow(a.id);
    await engine.runNow(b.id);
    expect(runs(b.id)[0]?.state).toBe("queued");
    expect(mgr.spawned).toHaveLength(1);

    finish(mgr.spawned[0]?.agentId as string);
    expect(runs(b.id)[0]?.state).toBe("running");
    expect(mgr.spawned).toHaveLength(2);
  });

  it("holds the slot through a timeout until the agent is stopped", async () => {
    engine.setMaxConcurrent(1);
    const a = addTask({ timeoutMinutes: 1 });
    const b = addTask();
    await engine.runNow(a.id);
    await engine.runNow(b.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mgr.stopped).toHaveLength(1);
    expect(runs(b.id)[0]?.state).toBe("running");
  });

  it("starts a queued run left by a previous session and closes an interrupted one", async () => {
    const a = addTask();
    const b = addTask();
    await engine.runNow(a.id);
    engine.stop();
    db.prepare("INSERT INTO scheduled_runs (id, task_id) VALUES ('q1', ?)").run(b.id);

    engine = new SchedulerEngine();
    engine.start(db);
    expect(runs(a.id)[0]?.state).toBe("failure");
    expect(listScheduledResults(db, a.id)[0]?.summary).toContain("Interrupted");
    expect(runs(b.id)[0]?.state).toBe("running");
  });
});

describe("SchedulerEngine dependencies and budget", () => {
  it("blocks a dependent after its dependency timed out", async () => {
    const dep = addTask({ timeoutMinutes: 1 });
    const child = addTask({ dependsOn: dep.id });
    await engine.runNow(dep.id);
    await engine.runNow(child.id);
    expect(runs(child.id)[0]?.state).toBe("queued");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs(child.id)[0]?.state).toBe("skipped");
    expect(mgr.spawned).toHaveLength(1);
  });

  it("runs a dependent once its dependency succeeds", async () => {
    const dep = addTask();
    const child = addTask({ dependsOn: dep.id });
    await engine.runNow(dep.id);
    await engine.runNow(child.id);
    finish(mgr.spawned[0]?.agentId as string);
    expect(runs(child.id)[0]?.state).toBe("running");
  });

  it("stops a run over its token budget", async () => {
    const task = addTask({ maxTokenBudget: 100 });
    await engine.runNow(task.id);
    const agentId = mgr.spawned[0]?.agentId as string;
    db.prepare(
      `INSERT INTO token_usage (id, agent_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, tool_call_count)
       VALUES ('t1', ?, 'anthropic', 'm', 80, 40, 0, 0)`,
    ).run(agentId);
    await vi.advanceTimersByTimeAsync(BUDGET_CHECK_MS);
    expect(mgr.stopped).toEqual([agentId]);
    expect(listScheduledResults(db, task.id).map((r) => r.status)).toEqual(["budget_exceeded"]);
  });
});
