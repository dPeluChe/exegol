import { describe, expect, it } from "vitest";
import type { SessionHistoryRow } from "../db/queries/agents";
import { mergeHistory } from "./merge";
import type { LocalSession } from "./types";

function exegolRow(over: Partial<SessionHistoryRow> = {}): SessionHistoryRow {
  return {
    id: "a1",
    alias: "draco",
    cliType: "claude-code",
    taskDescription: "fix auth",
    status: "completed",
    accessMode: "write",
    isolationMode: "isolated",
    branchName: "exegol/fix-auth",
    worktreePath: "/wt/fix-auth",
    startedAt: 1000,
    stoppedAt: 2000,
    archivedAt: null,
    score: 0.82,
    exitReason: "success",
    filesChanged: 4,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 1.4,
    oplogEntries: 3,
    hasFinalOutput: true,
    resumeCommand: null,
    claudeSessionId: null,
    ...over,
  };
}

function localSession(over: Partial<LocalSession> = {}): LocalSession {
  return {
    provider: "claude-code",
    sessionId: "uuid-1",
    title: "ran by hand",
    cwd: "/repo",
    branch: "main",
    startedAt: 500,
    endedAt: 900,
    version: "2.1.0",
    sizeBytes: 1234,
    ...over,
  };
}

describe("mergeHistory", () => {
  it("keeps both sources, newest first", () => {
    const merged = mergeHistory([exegolRow()], [localSession()]);
    expect(merged.map((e) => [e.origin, e.id])).toEqual([
      ["exegol", "a1"],
      ["local", "claude-code:uuid-1"],
    ]);
  });

  // The same claude session lives in BOTH stores when Exegol launched it, and
  // only the Exegol row carries the score, the spend and the oplog.
  it("drops the on-disk copy of a session Exegol launched", () => {
    const merged = mergeHistory(
      [exegolRow({ claudeSessionId: "uuid-1" })],
      [localSession({ sessionId: "uuid-1" }), localSession({ sessionId: "uuid-2" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.origin === "exegol")?.score).toBe(0.82);
    expect(merged.filter((e) => e.origin === "local").map((e) => e.sessionId)).toEqual(["uuid-2"]);
  });

  it("does not dedup across providers that happen to share an id", () => {
    const merged = mergeHistory(
      [exegolRow({ claudeSessionId: "shared" })],
      [localSession({ provider: "codex", sessionId: "shared" })],
    );
    expect(merged).toHaveLength(2);
  });

  // A store on disk records that a session existed, never how it went. Claiming
  // a status or a score would make the two sources indistinguishable.
  it("never invents an outcome for a local session", () => {
    const [local] = mergeHistory([], [localSession()]);
    expect(local).toMatchObject({ status: null, score: null, costUsd: 0, oplogEntries: 0 });
  });

  it("falls back to startedAt when a session never stopped", () => {
    const merged = mergeHistory(
      [exegolRow({ id: "old", stoppedAt: null, startedAt: 100 })],
      [localSession({ endedAt: 900 })],
    );
    expect(merged.map((e) => e.id)).toEqual(["claude-code:uuid-1", "old"]);
  });
});
