import type { AgentMessage, AgentMessageType, MessageDeliveryState } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

// ─── Row Mapper ──────────────────────────────────────────────────────────────

function mapMessageRow(row: Record<string, unknown>): AgentMessage {
  return {
    id: row.id as string,
    fromAgentId: (row.from_agent_id as string) ?? null,
    toAgentId: (row.to_agent_id as string) ?? null,
    type: row.type as AgentMessageType,
    content: row.content as string,
    createdAt: row.created_at as number,
    readAt: (row.read_at as number) ?? null,
    deliveryState: (row.delivery_state as MessageDeliveryState) ?? null,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function sendMessage(
  db: Database.Database,
  data: {
    fromAgentId: string | null;
    toAgentId: string | null;
    type: AgentMessageType;
    content: string;
    /** T170.1: the sender's own retry key — unique per sender, enforced by index. */
    clientKey?: string | null;
    deliveryState?: MessageDeliveryState;
  },
): AgentMessage {
  const id = nanoid();
  db.prepare(
    `INSERT INTO messages (id, from_agent_id, to_agent_id, type, content, client_key, delivery_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.fromAgentId,
    data.toAgentId,
    data.type,
    data.content,
    data.clientKey ?? null,
    data.deliveryState ?? null,
  );
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getMessage(db, id)!;
}

export function getMessage(db: Database.Database, id: string): AgentMessage | null {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapMessageRow(row) : null;
}

export function listMessages(
  db: Database.Database,
  filters: {
    agentId?: string;
    type?: AgentMessageType;
    /** Not yet pulled by the receiver (messages_check marks them read) */
    unreadOnly?: boolean;
  },
  limit = 100,
): AgentMessage[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.agentId) {
    conditions.push("(from_agent_id = ? OR to_agent_id = ?)");
    values.push(filters.agentId, filters.agentId);
  }

  if (filters.type) {
    conditions.push("type = ?");
    values.push(filters.type);
  }

  if (filters.unreadOnly) {
    conditions.push("read_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(limit);

  const rows = db
    .prepare(`SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values);
  return (rows as Record<string, unknown>[]).map(mapMessageRow);
}

export function listMessagesBetween(
  db: Database.Database,
  agentA: string,
  agentB: string,
  limit = 100,
): AgentMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE (from_agent_id = ? AND to_agent_id = ?)
          OR (from_agent_id = ? AND to_agent_id = ?)
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(agentA, agentB, agentB, agentA, limit);
  return (rows as Record<string, unknown>[]).map(mapMessageRow);
}

// ─── Delivery state (T170.1) ─────────────────────────────────────────────────
//
// This used to be a Map, so it died with the process: after a restart every
// `message_status` answered "unknown" and a retry re-delivered.

export function markMessageRead(db: Database.Database, id: string): void {
  db.prepare("UPDATE messages SET read_at = unixepoch() WHERE id = ? AND read_at IS NULL").run(id);
}

export type { MessageDeliveryState };

interface MessageDelivery {
  fromAgentId: string | null;
  toAgentId: string | null;
  state: MessageDeliveryState | null;
}

export function getMessageDelivery(db: Database.Database, id: string): MessageDelivery | null {
  const row = db
    .prepare("SELECT from_agent_id, to_agent_id, delivery_state FROM messages WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    fromAgentId: (row.from_agent_id as string) ?? null,
    toAgentId: (row.to_agent_id as string) ?? null,
    state: (row.delivery_state as MessageDeliveryState) ?? null,
  };
}

/** A terminal state is never overwritten: reporting a cancelled message as read
 *  would be worse than reporting nothing. */
export function setMessageDeliveryState(
  db: Database.Database,
  id: string,
  state: MessageDeliveryState,
): void {
  db.prepare(
    `UPDATE messages SET delivery_state = ?
     WHERE id = ?
       AND (delivery_state IS NULL
            OR delivery_state NOT IN ('consumed', 'cancelled', 'undeliverable'))`,
  ).run(state, id);
}

/** One statement for a whole dropped queue — an agent exit can strand ten. */
export function markMessagesUndeliverable(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  db.prepare(
    `UPDATE messages SET delivery_state = 'undeliverable'
     WHERE id IN (${ids.map(() => "?").join(",")})
       AND (delivery_state IS NULL
            OR delivery_state NOT IN ('consumed', 'cancelled', 'undeliverable'))`,
  ).run(...ids);
}

/** The message a previous send with this key produced, if any. */
export function findMessageByClientKey(
  db: Database.Database,
  fromAgentId: string,
  clientKey: string,
): string | null {
  const row = db
    .prepare("SELECT id FROM messages WHERE from_agent_id = ? AND client_key = ?")
    .get(fromAgentId, clientKey) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Startup sweep: the in-memory queue died with the process, so anything still
 *  marked queued was never going to arrive. Saying so beats leaving a sender
 *  waiting on a message that no longer exists anywhere. */
export function markStaleQueuedUndeliverable(db: Database.Database): number {
  const res = db
    .prepare("UPDATE messages SET delivery_state = 'undeliverable' WHERE delivery_state = 'queued'")
    .run();
  return Number(res.changes ?? 0);
}
