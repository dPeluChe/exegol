import type { SessionProcesses } from "@exegol/shared";
import type Database from "libsql";
import { listLiveSessionProcesses } from "../db/queries/agents";
import { readProcessTable } from "./process-table";
import { sessionProcesses } from "./session-processes";

const TABLE_MAX_AGE_MS = 5_000;

export async function readSessionProcesses(db: Database.Database): Promise<SessionProcesses[]> {
  const sessions = listLiveSessionProcesses(db);
  if (sessions.length === 0) return [];
  const rows = await readProcessTable({ maxAgeMs: TABLE_MAX_AGE_MS });
  return sessions
    .map((s) => sessionProcesses(s, rows, []))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.rssKb - a.rssKb);
}
