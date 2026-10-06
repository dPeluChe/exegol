import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trees: [] as string[],
  numstat: "",
  realGit: false,
  capture: Promise.resolve(""),
  commit: vi.fn((..._args: unknown[]) => "snap1234"),
  prepare: vi.fn(() => "safetytree"),
  broadcast: vi.fn(),
}));

vi.mock("../pipeline/git-evidence", async (importOriginal) => {
  const real = await importOriginal<typeof import("../pipeline/git-evidence")>();
  return {
    captureTree: vi.fn(async (cwd: string) => {
      if (!mocks.realGit) return mocks.trees.shift() ?? "tree";
      mocks.capture = real.captureTree(cwd);
      return mocks.capture;
    }),
    git: vi.fn(async (cwd: string, args: string[]) =>
      mocks.realGit ? real.git(cwd, args) : mocks.numstat,
    ),
  };
});
vi.mock("../pipeline/oplog-snapshots", () => ({
  commitStepSnapshot: mocks.commit,
  prepareStepSnapshot: mocks.prepare,
}));
vi.mock("../lib/event-bus", () => ({ broadcast: mocks.broadcast }));

import {
  endTurn,
  forgetTurns,
  latestTurn,
  MAX_TURNS_PER_AGENT,
  parseNumstat,
  startTurn,
  undoLatestTurn,
} from "./turn-snapshots";

describe("parseNumstat", () => {
  it("reads counts, binary files and tabs in paths", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\0-\t-\timg.png\u00000\t2\tweird\tname\0")).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1 },
      { path: "img.png", additions: null, deletions: null },
      { path: "weird\tname", additions: 0, deletions: 2 },
    ]);
  });

  it("is empty for no output", () => {
    expect(parseNumstat("")).toEqual([]);
  });
});

describe("turn bookkeeping", () => {
  beforeEach(() => {
    forgetTurns("a1");
    mocks.trees = [];
    mocks.numstat = "";
    mocks.realGit = false;
    vi.clearAllMocks();
  });

  async function turn(start: string, end: string, numstat = "1\t0\tx.ts") {
    mocks.trees.push(start, end);
    mocks.numstat = numstat;
    startTurn("a1", "/repo");
    await endTurn("a1", "p1", "claude-code");
  }

  it("records a turn that changed files and commits its start snapshot", async () => {
    await turn("t0", "t1");
    expect(mocks.commit).toHaveBeenCalledWith(
      "/repo",
      "t0",
      "a1",
      "claude-code",
      1,
      expect.any(String),
      "AgentTurn",
    );
    expect(latestTurn("a1").turn).toMatchObject({
      turnIndex: 1,
      snapshotSha: "snap1234",
      files: [{ path: "x.ts", additions: 1, deletions: 0 }],
    });
    expect(latestTurn("a1").turn).not.toHaveProperty("cwd");
    expect(mocks.broadcast).toHaveBeenCalledWith("agent:turn-changes", { agentId: "a1" });
  });

  it("skips a turn with no changes and keeps the earlier one", async () => {
    await turn("t0", "t1");
    await turn("t1", "t1");
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(latestTurn("a1").turn?.turnIndex).toBe(1);
  });

  it("Stop without a prompt does nothing", async () => {
    await endTurn("a1", "p1", "claude-code");
    expect(latestTurn("a1")).toEqual({ turn: null, inTurn: false });
  });

  it("a second prompt before Stop keeps the first start", async () => {
    mocks.trees.push("t0", "t5", "t9");
    mocks.numstat = "1\t1\ty.ts";
    startTurn("a1", "/repo");
    startTurn("a1", "/repo");
    await endTurn("a1", "p1", "claude-code");
    expect(mocks.commit).toHaveBeenCalledWith(
      "/repo",
      "t0",
      "a1",
      "claude-code",
      1,
      expect.any(String),
      "AgentTurn",
    );
    expect(latestTurn("a1").turn?.turnIndex).toBe(1);
  });

  it("is in a turn between prompt and Stop", async () => {
    mocks.trees.push("t0", "t0");
    startTurn("a1", "/repo");
    expect(latestTurn("a1").inTurn).toBe(true);
    await endTurn("a1", "p1", "claude-code");
    expect(latestTurn("a1").inTurn).toBe(false);
  });

  it("keeps the newest turns, capped", async () => {
    for (let i = 0; i < MAX_TURNS_PER_AGENT + 3; i++) await turn(`s${i}`, `e${i}`);
    expect(latestTurn("a1").turn?.turnIndex).toBe(MAX_TURNS_PER_AGENT + 3);
    await expect(undoLatestTurn("a1", 3)).rejects.toThrow(/newest/);
  });

  it("drops a turn that ended after the agent was forgotten", async () => {
    mocks.trees.push("t0", "t1");
    mocks.numstat = "1\t0\tx.ts\0";
    startTurn("a1", "/repo");
    const ending = endTurn("a1", "p1", "claude-code");
    forgetTurns("a1");
    await ending;
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(latestTurn("a1").turn).toBeNull();
  });

  it("undo is refused while a turn is open", async () => {
    await turn("t0", "t1");
    startTurn("a1", "/repo");
    await expect(undoLatestTurn("a1", 1)).rejects.toThrow(/in a turn/);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

// Real git in a temp repo: under a full parallel suite a run can pass the 5s default
describe("undo against a real repo", { timeout: 30_000 }, () => {
  let repo: string;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
  const read = (p: string) => readFileSync(join(repo, p), "utf-8");

  beforeEach(() => {
    forgetTurns("a1");
    vi.clearAllMocks();
    mocks.realGit = true;
    repo = mkdtempSync(join(tmpdir(), "exegol-turn-"));
    sh("init", "-q");
    sh("config", "user.email", "t@t");
    sh("config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "a0\n");
    writeFileSync(join(repo, "b.txt"), "b0\n");
    writeFileSync(join(repo, "gone.txt"), "g0\n");
    sh("add", ".");
    sh("commit", "-qm", "init");
  });

  afterEach(() => {
    mocks.realGit = false;
    rmSync(repo, { recursive: true, force: true });
  });

  it("puts back untouched files, skips edited ones, makes no commit", async () => {
    const head = sh("rev-parse", "HEAD");
    startTurn("a1", repo);
    await mocks.capture;
    writeFileSync(join(repo, "a.txt"), "a1\n");
    writeFileSync(join(repo, "b.txt"), "b1\n");
    writeFileSync(join(repo, "new.txt"), "n1\n");
    rmSync(join(repo, "gone.txt"));
    await endTurn("a1", "p1", "claude-code");
    expect(
      latestTurn("a1")
        .turn?.files.map((f) => f.path)
        .sort(),
    ).toEqual(["a.txt", "b.txt", "gone.txt", "new.txt"]);

    writeFileSync(join(repo, "b.txt"), "b2 by the user\n");
    const result = await undoLatestTurn("a1", 1);

    expect(result.projectId).toBe("p1");
    expect(result.restored.sort()).toEqual(["a.txt", "gone.txt", "new.txt"]);
    expect(result.skipped).toEqual(["b.txt"]);
    expect(read("a.txt")).toBe("a0\n");
    expect(read("b.txt")).toBe("b2 by the user\n");
    expect(read("gone.txt")).toBe("g0\n");
    expect(existsSync(join(repo, "new.txt"))).toBe(false);
    expect(sh("rev-parse", "HEAD")).toBe(head);
    expect(mocks.commit).toHaveBeenLastCalledWith(
      repo,
      "safetytree",
      "a1",
      "claude-code",
      1,
      expect.any(String),
      "PreRestore",
    );
    expect(latestTurn("a1").turn).toBeNull();
  });

  it("restores nothing and keeps the turn when every file changed since", async () => {
    startTurn("a1", repo);
    await mocks.capture;
    writeFileSync(join(repo, "a.txt"), "a1\n");
    await endTurn("a1", "p1", "claude-code");
    writeFileSync(join(repo, "a.txt"), "a2\n");
    const result = await undoLatestTurn("a1", 1);
    expect(result).toEqual({ projectId: "p1", restored: [], skipped: ["a.txt"] });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(latestTurn("a1").turn?.turnIndex).toBe(1);
  });
});
