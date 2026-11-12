import type { SessionProcesses } from "@exegol/shared";
import type Database from "libsql";
import { listLiveSessionProcesses } from "../db/queries/agents";
import { type KnownServer, knownClaudeServers } from "../mcp/claude-servers";
import { readProcessTable } from "./process-table";
import { indexProcesses } from "./process-tree";
import { sessionProcesses } from "./session-processes";

const TABLE_MAX_AGE_MS = 5_000;

export async function readSessionProcesses(db: Database.Database): Promise<SessionProcesses[]> {
  const sessions = listLiveSessionProcesses(db);
  if (sessions.length === 0) return [];
  const paths = [...new Set(sessions.flatMap((s) => (s.projectPath ? [s.projectPath] : [])))];
  const [rows, ...known] = await Promise.all([
    readProcessTable({ maxAgeMs: TABLE_MAX_AGE_MS }),
    ...paths.map(knownClaudeServers),
  ]);
  const knownIn = new Map<string, KnownServer[]>(paths.map((p, i) => [p, known[i] ?? []]));
  const index = indexProcesses(rows);
  return sessions
    .map((s) => sessionProcesses(s, rows, knownIn.get(s.projectPath ?? "") ?? [], index))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.rssKb - a.rssKb);
}
