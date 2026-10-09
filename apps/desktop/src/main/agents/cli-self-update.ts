import type Database from "libsql";
import { getAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { installedCliVersion } from "../system/cli-versions";
import { selfUpdatedVersion } from "./cli-install-method";

/** After a session's CLI exited on its own: if the installed version is no longer the one it
 *  started with, the CLI updated itself (codex exits asking to be restarted). The renderer then
 *  shows the update and Restart session instead of a plain end */
export async function detectCliSelfUpdate(
  db: Database.Database,
  agent: { id: string; projectId: string; cliType: string },
): Promise<string | null> {
  const from = getAgent(db, agent.id)?.cliVersion ?? null;
  if (!from) return null;
  const to = selfUpdatedVersion(from, await installedCliVersion(agent.cliType, true));
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
