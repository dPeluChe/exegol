import type Database from "libsql";
import { getAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { runningCliBinary } from "../system/cli-versions";
import { selfUpdatedVersion } from "./cli-install-method";

/** After a session's CLI exited on its own: if the copy that runs was rewritten during the
 *  session and is another version, the CLI updated itself (codex exits asking to be restarted).
 *  The renderer then shows the update and Restart session instead of a plain end */
export async function detectCliSelfUpdate(
  db: Database.Database,
  agent: { id: string; projectId: string; cliType: string },
  exitCode: number,
): Promise<string | null> {
  if (exitCode !== 0) return null;
  const row = getAgent(db, agent.id);
  const from = row?.cliVersion ?? null;
  if (!from || !row?.startedAt) return null;
  const running = await runningCliBinary(agent.cliType);
  const to = selfUpdatedVersion({
    exitCode,
    recorded: from,
    current: running?.version,
    binaryChangedAtMs: running?.changedAtMs ?? null,
    // started_at is unix seconds
    startedAtMs: row.startedAt * 1000,
  });
  if (!to) return null;
  logger.info(`[CliUpdate] ${agent.cliType} updated itself ${from} -> ${to}`);
  broadcast("agent:cli-self-updated", {
    agentId: agent.id,
    projectId: agent.projectId,
    cliType: agent.cliType,
    from,
    to,
  });
  return to;
}
