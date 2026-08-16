/**
 * T162 phase 1 — Exegol-ENFORCED notification links, fired from the same
 * turn-boundary choke point as message delivery so "when you finish, tell X"
 * happens even when the model forgets.
 *
 * Split out of agent-messaging.ts; it only needs sendAgentMessage.
 */

import type Database from "libsql";
import { deleteAgentLink, deleteLinksForAgent, listLinksFrom } from "../db/queries/agent-links";
import { logger } from "../lib/logger";
import { sendAgentMessage } from "./agent-messaging";

const LINK_ROLE_FRAMING: Record<string, string> = {
  notify: "You were linked to be NOTIFIED when it finishes a turn.",
  reviewer:
    "You are linked as its REVIEWER: examine what it just did (ask it for a summary or diff via agent_send) and report discrepancies.",
  feedback:
    "You are linked to give FEEDBACK on its work: ask what it did if needed, then send your assessment.",
};

/**
 * T162 phase 1: Exegol-ENFORCED notification — fired from the same turn-boundary
 * choke point as message delivery, so "cuando termines avísale a X" happens even
 * when the model forgets. One-shot links expire after firing; all links die with
 * either endpoint (agent exit) so a name reuse can never inherit them.
 */
// In-memory set of agents with outgoing links — the common case is ZERO, so
// this skips a DB SELECT on every turn boundary (simplify: eff-1). Seeded at
// startup; kept in sync by create/clear.
const agentsWithLinks = new Set<string>();

export function seedAgentLinkCache(db: Database.Database): void {
  agentsWithLinks.clear();
  try {
    const rows = db.prepare("SELECT DISTINCT from_agent_id FROM agent_links").all() as Array<{
      from_agent_id: string;
    }>;
    for (const r of rows) agentsWithLinks.add(r.from_agent_id);
  } catch {
    /* table not ready — fine, cache stays empty */
  }
}

export function noteAgentHasLink(fromAgentId: string): void {
  agentsWithLinks.add(fromAgentId);
}

export function fireAgentLinks(db: Database.Database, agentId: string): void {
  if (!agentsWithLinks.has(agentId)) return;
  const links = listLinksFrom(db, agentId);
  if (links.length === 0) {
    agentsWithLinks.delete(agentId);
    return;
  }
  for (const link of links) {
    const framing = LINK_ROLE_FRAMING[link.role] ?? LINK_ROLE_FRAMING.notify;
    const note = link.note ? `\nContext from the link: ${link.note}` : "";
    try {
      sendAgentMessage(db, {
        fromAgentId: link.fromAgentId,
        toAgentId: link.toAgentId,
        text: `(automatic link notification) I just finished a turn. ${framing}${note}`,
        expectsReply: link.role !== "notify",
        system: true,
      });
      logger.info(
        `[AgentLink] Fired ${link.id} (${link.role}) ${link.fromAgentId} → ${link.toAgentId}`,
      );
      // Consume one-shot links ONLY on a successful send — a throttled/failed
      // fire must survive to the next boundary (simplify A5: the exact loss
      // T162 exists to prevent).
      if (link.once) deleteAgentLink(db, link.id);
    } catch (err) {
      logger.warn(`[AgentLink] Fire failed for ${link.id} (will retry next turn): ${err}`);
    }
  }
  if (listLinksFrom(db, agentId).length === 0) agentsWithLinks.delete(agentId);
}

/** Remove links touching a dead agent (called next to queue/token cleanup). */
export function clearAgentLinks(db: Database.Database, agentId: string): void {
  agentsWithLinks.delete(agentId);
  deleteLinksForAgent(db, agentId);
}
