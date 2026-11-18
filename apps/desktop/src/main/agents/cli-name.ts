import { renameEffect } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, setAgentCliName } from "../db/queries/agents";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { setBounded } from "../lib/set-bounded";
import { cliNameOf } from "./session-chat";
import { renameAgent } from "./session-name";

// A session not found in its CLI's store costs a scan of that store: not on every turn
const MISSING_RETRY_MS = 10 * 60_000;
const MAX_TRACKED = 256;
const missing = new Map<string, number>();
const reading = new Set<string>();

/** Keeps the name a session has inside its CLI; one the person gave there (Claude's /rename)
 *  becomes its name in Exegol too */
export async function followCliName(db: Database.Database, agentId: string): Promise<void> {
  if (reading.has(agentId)) return;
  if (Date.now() - (missing.get(agentId) ?? 0) < MISSING_RETRY_MS) return;
  reading.add(agentId);
  try {
    const agent = getAgent(db, agentId);
    if (!agent) return;
    const read = await cliNameOf(db, agent);
    if (!read) {
      setBounded(missing, agentId, Date.now(), MAX_TRACKED);
      return;
    }
    const effect = renameEffect(agent, read);
    if (!effect) return;
    setAgentCliName(db, agentId, effect.cliName);
    if (effect.alias) {
      renameAgent(db, agent, effect.alias);
      logger.info(`[CliName] ${agentId} renamed in its CLI: the session name follows`);
    }
    broadcast("agent:renamed", {
      agentId,
      cliName: effect.cliName,
      ...(effect.alias ? { alias: effect.alias } : {}),
    });
  } catch (err) {
    logger.warn(`[CliName] ${agentId} name not read:`, err);
  } finally {
    reading.delete(agentId);
  }
}
