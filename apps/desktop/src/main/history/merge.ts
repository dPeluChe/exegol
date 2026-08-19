import type { HistoryEntry } from "@exegol/shared";
import type { LocalSession } from "./types";

function fromLocal(session: LocalSession): HistoryEntry {
  return {
    origin: "local",
    id: `${session.provider}:${session.sessionId}`,
    provider: session.provider,
    label: session.title ?? session.sessionId.slice(0, 8),
    task: null,
    branch: session.branch,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    // A store on disk records that a session happened, never how it went.
    // Claiming an outcome would make the two sources indistinguishable.
    status: null,
    score: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    oplogEntries: 0,
    hasFinalOutput: false,
    archived: false,
    sessionId: session.sessionId,
    version: session.version,
    sizeBytes: session.sizeBytes,
  };
}

/**
 * Merge both sources, newest first, without showing a session twice.
 *
 * An Exegol-launched claude session ALSO lives in `~/.claude/projects`, so the
 * two lists overlap. Where we can prove they are the same session — the provider
 * session id captured at spawn — the Exegol row wins, because it carries the
 * score, the spend and the oplog that the file on disk cannot.
 */
export function mergeHistory(exegol: HistoryEntry[], local: LocalSession[]): HistoryEntry[] {
  const known = new Set(
    exegol.flatMap((e) => (e.sessionId ? [`${e.provider}:${e.sessionId}`] : [])),
  );

  return [
    ...exegol,
    ...local.filter((s) => !known.has(`${s.provider}:${s.sessionId}`)).map(fromLocal),
  ].sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
}
