import { setImmediate } from "node:timers/promises";
import { renameEffect } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, setAgentCliName } from "../db/queries/agents";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { setBounded } from "../lib/set-bounded";
import { NAME_READERS } from "./session-chat";
import { renameAgent } from "./session-name";

// A session not found in its CLI's store costs a scan of that store: not on every turn
const MISSING_RETRY_MS = 10 * 60_000;
const MAX_TRACKED = 256;
const nextRead = new Map<string, number>();
const reading = new Set<string>();

/** Keeps the name a session has inside its CLI; one the person gave there (Claude's /rename)
 *  becomes its name in Exegol too. Called at every turn start and end: the CLI's reader says
 *  which of the two it reads at */
export async function followCliName(
  db: Database.Database,
  session: { id: string; cliType: string },
  at: "turn_start" | "turn_end",
): Promise<void> {
  const reader = NAME_READERS[session.cliType];
  if (reader?.at !== at || reading.has(session.id)) return;
  if (Date.now() < (nextRead.get(session.id) ?? 0)) return;
  reading.add(session.id);
  try {
    // Off the status path that called: two of the stores are read synchronously
    await setImmediate();
    const agent = getAgent(db, session.id);
    if (!agent) return;
    const read = await reader.read(db, agent);
    const wait = read ? reader.everyMs : MISSING_RETRY_MS;
    if (wait > 0) setBounded(nextRead, session.id, Date.now() + wait, MAX_TRACKED);
    const effect = read && renameEffect(agent, read);
    if (!effect) return;
    setAgentCliName(db, session.id, effect.cliName);
    if (effect.alias) {
      renameAgent(db, agent, effect.alias);
      logger.info(`[CliName] ${session.id} renamed in its CLI: the session name follows`);
    }
    broadcast("agent:renamed", { agentId: session.id, ...effect });
  } catch (err) {
    logger.warn(`[CliName] ${session.id} name not read:`, err);
  } finally {
    reading.delete(session.id);
  }
}
