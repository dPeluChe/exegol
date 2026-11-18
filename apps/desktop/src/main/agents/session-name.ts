import type Database from "libsql";
import { setAgentAlias } from "../db/queries/agents";
import { renameSession } from "../inbox/threads";

/** A session's name changes: the inbox threads for it follow */
export function renameAgent(
  db: Database.Database,
  agent: { id: string; projectId: string; alias?: string | null },
  alias: string | null,
): void {
  setAgentAlias(db, agent.id, alias);
  if (agent.alias) renameSession(db, agent.projectId, agent.alias, alias);
}
