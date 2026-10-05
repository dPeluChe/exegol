import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trees: [] as string[],
  numstat: "",
  restore: vi.fn(() => "newsha12345"),
  commit: vi.fn(() => "snap1234"),
  broadcast: vi.fn(),
}));

vi.mock("../pipeline/git-evidence", () => ({
  captureTree: vi.fn(async () => mocks.trees.shift() ?? "tree"),
  git: vi.fn(async () => mocks.numstat),
}));
vi.mock("../pipeline/oplog-snapshots", () => ({ commitStepSnapshot: mocks.commit }));
vi.mock("./spawn-env", () => ({ coreRust: { restoreOplogSnapshot: mocks.restore } }));
vi.mock("../lib/event-bus", () => ({ broadcast: mocks.broadcast }));

import {
  endTurn,
  forgetTurns,
  latestTurn,
  MAX_TURNS_PER_AGENT,
  parseNumstat,
  pushTurn,
  startTurn,
  undoLatestTurn,
} from "./turn-snapshots";

describe("parseNumstat", () => {
  it("reads counts, binary files and tabs in paths", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\n-\t-\timg.png\n0\t2\tweird\tname\n")).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1 },
      { path: "img.png", additions: null, deletions: null },
      { path: "weird\tname", additions: 0, deletions: 2 },
    ]);
  });

  it("is empty for no output", () => {
    expect(parseNumstat("")).toEqual([]);
  });
});

describe("pushTurn", () => {
  it("keeps the newest first and drops past the cap", () => {
    let list: number[] = [];
    for (let i = 1; i <= MAX_TURNS_PER_AGENT + 5; i++) list = pushTurn(list, i);
    expect(list).toHaveLength(MAX_TURNS_PER_AGENT);
    expect(list[0]).toBe(MAX_TURNS_PER_AGENT + 5);
    expect(list.at(-1)).toBe(6);
  });
});

describe("turn bookkeeping", () => {
  beforeEach(() => {
    forgetTurns("a1");
    mocks.trees = [];
    mocks.numstat = "";
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
    expect(latestTurn("a1")).toMatchObject({
      turnIndex: 1,
      snapshotSha: "snap1234",
      files: [{ path: "x.ts", additions: 1, deletions: 0 }],
    });
    expect(latestTurn("a1")).not.toHaveProperty("cwd");
    expect(mocks.broadcast).toHaveBeenCalledWith("agent:turn-changes", { agentId: "a1" });
  });

  it("skips a turn with no changes and keeps the earlier one", async () => {
    await turn("t0", "t1");
    await turn("t1", "t1");
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(latestTurn("a1")?.turnIndex).toBe(1);
  });

  it("Stop without a prompt does nothing", async () => {
    await endTurn("a1", "p1", "claude-code");
    expect(latestTurn("a1")).toBeNull();
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
    expect(latestTurn("a1")?.turnIndex).toBe(1);
  });

  it("undo restores the newest turn's snapshot and drops it", async () => {
    await turn("t0", "t1");
    await turn("t1", "t2");
    expect(() => undoLatestTurn("a1", 1)).toThrow(/newest/);
    expect(undoLatestTurn("a1", 2)).toBe("newsha12345");
    expect(mocks.restore).toHaveBeenCalledWith("/repo", "snap1234");
    expect(latestTurn("a1")?.turnIndex).toBe(1);
  });

  it("undo is refused while a turn is open", async () => {
    await turn("t0", "t1");
    startTurn("a1", "/repo");
    expect(() => undoLatestTurn("a1", 1)).toThrow(/in a turn/);
    expect(mocks.restore).not.toHaveBeenCalled();
  });
});
