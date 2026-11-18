import { renameEffect } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, setAgentCliName } from "../db/queries/agents";
import { claudeRenamedTo } from "../history/providers/claude-code";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { setBounded } from "../lib/set-bounded";
import { transcriptFile } from "./session-chat";
import { renameAgent } from "./session-name";

// A transcript not found costs a scan of the CLI's whole store: not on every turn
const MISSING_RETRY_MS = 10 * 60_000;
const MAX_TRACKED = 256;
const missing = new Map<string, number>();
const reading = new Set<string>();

/** A Claude session renamed inside its CLI (/rename) takes that name in Exegol too */
export async function followCliRename(db: Database.Database, agentId: string): Promise<void> {
  if (reading.has(agentId)) return;
  if (Date.now() - (missing.get(agentId) ?? 0) < MISSING_RETRY_MS) return;
  reading.add(agentId);
  try {
    const agent = getAgent(db, agentId);
    if (!agent) return;
    const path = await transcriptFile(db, agent);
    if (!path) {
      setBounded(missing, agentId, Date.now(), MAX_TRACKED);
      return;
    }
    const effect = renameEffect(agent, await claudeRenamedTo(path));
    if (!effect) return;
    setAgentCliName(db, agentId, effect.cliName);
    if (!effect.alias) return;
    renameAgent(db, agent, effect.alias);
    logger.info(`[CliName] ${agentId} renamed in its CLI: the session name follows`);
    broadcast("agent:renamed", { agentId, alias: effect.alias });
  } catch (err) {
    logger.warn(`[CliName] ${agentId} name not read:`, err);
  } finally {
    reading.delete(agentId);
  }
}
