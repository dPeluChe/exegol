import type { SessionHistoryRow } from "../db/queries/agents";
import type { LocalSession } from "./types";

/**
 * One row in Project › History. `origin` is the honest distinction: Exegol knows
 * the score, the spend and the oplog for what IT launched, and knows only what
 * the CLI's own store recorded for everything else.
 */
export interface HistoryEntry {
  origin: "exegol" | "local";
  id: string;
  provider: string;
  /** Session codename for Exegol runs; the CLI's own title otherwise. */
  label: string;
  task: string | null;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  status: string | null;
  score: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  oplogEntries: number;
  hasFinalOutput: boolean;
  archived: boolean;
  /** The provider's own session id, when we have one — what resume takes. */
  sessionId: string | null;
}

function fromExegol(row: SessionHistoryRow): HistoryEntry {
  return {
    origin: "exegol",
    id: row.id,
    provider: row.cliType,
    label: row.alias ?? row.taskDescription,
    task: row.taskDescription,
    branch: row.branchName,
    startedAt: row.startedAt,
    endedAt: row.stoppedAt,
    status: row.status,
    score: row.score,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    oplogEntries: row.oplogEntries,
    hasFinalOutput: row.hasFinalOutput,
    archived: row.archivedAt !== null,
    sessionId: row.claudeSessionId,
  };
}

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
    // A store on disk records no outcome — claiming one would be inventing it.
    status: null,
    score: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    oplogEntries: 0,
    hasFinalOutput: false,
    archived: false,
    sessionId: session.sessionId,
  };
}

/**
 * Merge both sources, newest first, without showing a session twice.
 *
 * An Exegol-launched claude session ALSO lives in `~/.claude/projects`, so the
 * two lists overlap. Where we can prove they are the same session — the provider
 * session id we captured at spawn — the Exegol row wins, because it carries the
 * score, the spend and the oplog that the file on disk cannot.
 */
export function mergeHistory(rows: SessionHistoryRow[], local: LocalSession[]): HistoryEntry[] {
  const known = new Set(
    rows.flatMap((r) => (r.claudeSessionId ? [`${r.cliType}:${r.claudeSessionId}`] : [])),
  );

  const entries = [
    ...rows.map(fromExegol),
    ...local.filter((s) => !known.has(`${s.provider}:${s.sessionId}`)).map(fromLocal),
  ];

  return entries.sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
}
