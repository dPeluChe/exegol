import type { HistoryEntry } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { mergeHistory } from "./merge";
import type { LocalSession } from "./types";

function exegolRow(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    origin: "exegol",
    id: "a1",
    provider: "claude-code",
    label: "draco",
    task: "fix auth",
    branch: "exegol/fix-auth",
    startedAt: 1000,
    endedAt: 2000,
    status: "completed",
    score: 0.82,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 1.4,
    oplogEntries: 3,
    hasFinalOutput: true,
    archived: false,
    sessionId: null,
    version: null,
    sizeBytes: 0,
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
      [exegolRow({ sessionId: "uuid-1" })],
      [localSession({ sessionId: "uuid-1" }), localSession({ sessionId: "uuid-2" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.origin === "exegol")?.score).toBe(0.82);
    expect(merged.filter((e) => e.origin === "local").map((e) => e.sessionId)).toEqual(["uuid-2"]);
  });

  it("does not dedup across providers that happen to share an id", () => {
    const merged = mergeHistory(
      [exegolRow({ sessionId: "shared" })],
      [localSession({ provider: "codex", sessionId: "shared" })],
    );
    expect(merged).toHaveLength(2);
  });

  // The dedupe key used to be the claude-only `claude_session_id`, so every
  // codex/opencode session Exegol launched appeared twice — once with its
  // score, once as "outside Exegol".
  it("dedups a codex session Exegol launched, not just a claude one", () => {
    const merged = mergeHistory(
      [exegolRow({ id: "a2", provider: "codex", sessionId: "019f8b75" })],
      [localSession({ provider: "codex", sessionId: "019f8b75" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.origin).toBe("exegol");
  });

  // A store on disk records that a session existed, never how it went. Claiming
  // a status or a score would make the two sources indistinguishable.
  it("never invents an outcome for a local session", () => {
    const [local] = mergeHistory([], [localSession()]);
    expect(local).toMatchObject({ status: null, score: null, costUsd: 0, oplogEntries: 0 });
  });

  it("falls back to startedAt when a session never stopped", () => {
    const merged = mergeHistory(
      [exegolRow({ id: "old", endedAt: null, startedAt: 100 })],
      [localSession({ endedAt: 900 })],
    );
    expect(merged.map((e) => e.id)).toEqual(["claude-code:uuid-1", "old"]);
  });
});
