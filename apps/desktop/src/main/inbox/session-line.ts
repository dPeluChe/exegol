import type Database from "libsql";
import { listThreads } from "../db/queries/inbox";

const COUNT_LIMIT = 200;

/** What a starting session is told, resume and quick launch included: a prompt would start a turn */
export function sessionLine(db: Database.Database, projectId: string): string {
  const waiting = listThreads(db, { projectId, state: "active", limit: COUNT_LIMIT }).length;
  if (waiting === 0) return "";
  const threads = waiting === 1 ? "1 thread" : `${waiting} threads`;
  return `Inbox: ${threads} waiting for this project. See them with inbox_list.`;
}
