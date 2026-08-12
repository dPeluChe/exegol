import type { PipelineStepDef } from "@exegol/shared";
import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { createPipelineTemplate, createProject, getPipelineRun } from "../db/queries";
import { logger } from "../lib/logger";
import { PipelineExecutor } from "./executor";

const mocks = vi.hoisted(() => {
  const completionCallbacks = new Map<string, (exitCode: number) => void>();
  const manager = {
    spawn: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onAgentComplete: vi.fn((agentId: string, cb: (exitCode: number) => void) => {
      completionCallbacks.set(agentId, cb);
    }),
    onAgentData: vi.fn(() => () => {}),
  };
  return { completionCallbacks, manager };
});

vi.mock("../agents/manager", () => ({ getAgentManager: () => mocks.manager }));
vi.mock("../agents/registry", () => ({
  getProviderRegistry: () => ({
    get: () => ({ args: [], capabilities: { pipelineIdleCloseSeconds: 0 } }),
  }),
}));
vi.mock("../agents/spawn-env", () => ({
  coreRust: null,
  slugifyBranchName: (s: string) => s,
}));
vi.mock("../agents/worktrees", () => ({
  createManagedWorktree: vi.fn(),
  removeManagedWorktree: vi.fn(),
}));
vi.mock("../hooks/project-hooks", () => ({ runSetupHook: vi.fn(async () => {}) }));
vi.mock("../knowledge/context", () => ({ buildKnowledgeContext: () => "" }));
vi.mock("./oplog-snapshots", () => ({
  prepareStepSnapshot: () => null,
  commitStepSnapshot: vi.fn(),
}));
vi.mock("./evidence", () => ({
  attachStepScore: () => null,
  summarizeStepDiff: vi.fn(async () => null),
}));
vi.mock("./evaluator-step-handler", () => ({ handleEvaluatorStep: vi.fn(async () => {}) }));
vi.mock("../terminal/pty-host", () => ({
  getPtyHost: () => ({ isAlive: () => false, kill: vi.fn() }),
}));
vi.mock("./pipeline-helpers", () => ({
  YOLO_FLAGS: {},
  broadcastPipelineStatus: vi.fn(),
  captureGitDiff: vi.fn(async () => ""),
  readScrollbackSummary: vi.fn(async () => ""),
  now: () => Math.floor(Date.now() / 1000),
  checkGitSync: vi.fn(),
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function lastAgentId(db: Database.Database, runId: string): string {
  const run = getPipelineRun(db, runId);
  const agentId = run?.stepResults.at(-1)?.agentId;
  if (!agentId) throw new Error("no agent spawned for run");
  return agentId;
}

async function completeCurrentStep(
  db: Database.Database,
  runId: string,
  exitCode: number,
): Promise<void> {
  const cb = mocks.completionCallbacks.get(lastAgentId(db, runId));
  if (!cb) throw new Error("no completion callback registered");
  cb(exitCode);
  await settle();
}

describe("PipelineExecutor", () => {
  let db: Database.Database;
  let executor: PipelineExecutor;
  let projectId: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  function makeTemplate(steps: PipelineStepDef[]): string {
    return createPipelineTemplate(db, { projectId, name: "tpl", description: "", steps }).id;
  }

  function step(overrides: Partial<PipelineStepDef> = {}): PipelineStepDef {
    return {
      label: "step",
      cliType: "claude-code",
      role: "implement",
      promptTemplate: "do {{task}}",
      ...overrides,
    };
  }

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projectId = createProject(db, {
      name: "proj",
      path: `/tmp/exegol-test-${Math.random()}`,
      gitRemote: null,
      defaultBranch: "main",
      defaultIde: "vscode",
    }).id;
    executor = new PipelineExecutor();
    mocks.completionCallbacks.clear();
    mocks.manager.spawn.mockClear();
    mocks.manager.stop.mockClear();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("runs the valid path: pending → running → step advance → completed", async () => {
    const templateId = makeTemplate([step({ label: "one" }), step({ label: "two" })]);

    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    expect(run.status).toBe("running");
    expect(run.currentStepIndex).toBe(0);
    expect(mocks.manager.spawn).toHaveBeenCalledTimes(1);

    await completeCurrentStep(db, run.id, 0);
    let fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("running");
    expect(fresh?.currentStepIndex).toBe(1);
    expect(mocks.manager.spawn).toHaveBeenCalledTimes(2);

    await completeCurrentStep(db, run.id, 0);
    fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("completed");
    expect(fresh?.completedAt).not.toBeNull();
    expect(fresh?.stepResults.map((r) => r.status)).toEqual(["completed", "completed"]);
  });

  it("rejects invalid transitions with a warning instead of throwing", async () => {
    const templateId = makeTemplate([step()]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    await completeCurrentStep(db, run.id, 0);
    expect(getPipelineRun(db, run.id)?.status).toBe("completed");

    warnSpy.mockClear();
    await expect(executor.cancelRun(db, run.id)).resolves.toBeUndefined();
    expect(getPipelineRun(db, run.id)?.status).toBe("completed");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid state transition: completed → cancelled"),
    );

    warnSpy.mockClear();
    executor.pauseRun(db, run.id);
    expect(getPipelineRun(db, run.id)?.status).toBe("completed");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid state transition: completed → paused"),
    );
  });

  it("pauses a running step (stopping its agent) and resumes from the same index", async () => {
    const templateId = makeTemplate([step()]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    const agentId = lastAgentId(db, run.id);

    executor.pauseRun(db, run.id, "manual");
    expect(getPipelineRun(db, run.id)?.status).toBe("paused");
    expect(mocks.manager.stop).toHaveBeenCalledWith(db, agentId);

    await executor.resumeRun(db, run.id);
    const fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("running");
    expect(fresh?.currentStepIndex).toBe(0);
    expect(mocks.manager.spawn).toHaveBeenCalledTimes(2);
  });

  it("refuses to resume a run that is not paused", async () => {
    const templateId = makeTemplate([step()]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    await expect(executor.resumeRun(db, run.id)).rejects.toThrow("is not paused");
  });

  it("cancels a running pipeline, skips in-flight steps, and ignores late agent exits", async () => {
    const templateId = makeTemplate([step(), step()]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    const agentId = lastAgentId(db, run.id);

    await executor.cancelRun(db, run.id);
    let fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("cancelled");
    expect(fresh?.stepResults[0]?.status).toBe("skipped");
    expect(mocks.manager.stop).toHaveBeenCalledWith(db, agentId);

    // Late PTY exit after cancel must not advance or resurrect the run.
    mocks.completionCallbacks.get(agentId)?.(0);
    await settle();
    fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("cancelled");
    expect(mocks.manager.spawn).toHaveBeenCalledTimes(1);
  });

  it("loops back on failure and pauses when max iterations is reached", async () => {
    const templateId = makeTemplate([
      step({ label: "implement" }),
      step({ label: "review", loopBackTo: 0 }),
    ]);
    const run = await executor.startRun(db, templateId, projectId, "task", 2, false);

    await completeCurrentStep(db, run.id, 0); // implement ok → review
    await completeCurrentStep(db, run.id, 1); // review fails → loop back (iteration 1)
    let fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("running");
    expect(fresh?.currentStepIndex).toBe(0);
    expect(fresh?.iterationCount).toBe(1);

    await completeCurrentStep(db, run.id, 0); // implement ok → review
    await completeCurrentStep(db, run.id, 1); // review fails → max iterations hit
    fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("paused");
    expect(fresh?.iterationCount).toBe(2);
    expect(mocks.manager.spawn).toHaveBeenCalledTimes(4);
  });

  it("pauses a failed step that has no loop-back and no allowFailure", async () => {
    const templateId = makeTemplate([step({ label: "only" })]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);

    await completeCurrentStep(db, run.id, 1);
    const fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("paused");
    expect(fresh?.stepResults[0]?.status).toBe("failed");
    expect(fresh?.stepResults[0]?.exitCode).toBe(1);
  });

  it("continues past a failed step marked allowFailure", async () => {
    const templateId = makeTemplate([step({ label: "flaky", allowFailure: true }), step()]);
    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);

    await completeCurrentStep(db, run.id, 1);
    let fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("running");
    expect(fresh?.currentStepIndex).toBe(1);

    await completeCurrentStep(db, run.id, 0);
    fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("completed");
    expect(fresh?.stepResults.map((r) => r.status)).toEqual(["failed", "completed"]);
  });

  it("marks the step failed and pauses when the agent spawn itself throws", async () => {
    mocks.manager.spawn.mockRejectedValueOnce(new Error("no pty"));
    const templateId = makeTemplate([step()]);

    const run = await executor.startRun(db, templateId, projectId, "task", 5, false);
    await settle();

    const fresh = getPipelineRun(db, run.id);
    expect(fresh?.status).toBe("paused");
    expect(fresh?.stepResults[0]?.status).toBe("failed");
  });
});
