import type Database from "libsql";
import { countActiveThreads } from "../db/queries/inbox";

/** What a starting session is told, resume and quick launch included: a prompt would start a turn */
export function sessionLine(db: Database.Database, projectId: string): string {
  const waiting = countActiveThreads(db, projectId);
  if (waiting === 0) return "";
  const threads = waiting === 1 ? "1 thread" : `${waiting} threads`;
  return `Inbox: ${threads} waiting for this project. See them with inbox_list.`;
}
