import type { AgentMessage, AgentMessageType } from "@exegol/shared";
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

export function markMessageRead(db: Database.Database, id: string): void {
  db.prepare("UPDATE messages SET read_at = unixepoch() WHERE id = ? AND read_at IS NULL").run(id);
}

export function markAllRead(db: Database.Database, agentId: string): void {
  db.prepare(
    "UPDATE messages SET read_at = unixepoch() WHERE to_agent_id = ? AND read_at IS NULL",
  ).run(agentId);
}

export function countUnread(db: Database.Database, agentId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE to_agent_id = ? AND read_at IS NULL")
    .get(agentId) as { count: number };
  return row.count;
}

// ─── Delivery state (T170.1) ─────────────────────────────────────────────────
//
// This used to be a Map, so it died with the process: after a restart every
// `message_status` answered "unknown" and a retry re-delivered.

/** `queued` and `delivered` are transport; `consumed` is the receiver's own
 *  turn boundary. Only the terminal three are final. */
export type MessageDeliveryState =
  | "queued"
  | "delivered"
  | "consumed"
  | "cancelled"
  | "undeliverable";

const TERMINAL_STATES: MessageDeliveryState[] = ["consumed", "cancelled", "undeliverable"];

export interface MessageDelivery {
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
  const stamp = state === "delivered" ? "delivered_at = unixepoch(), " : "";
  db.prepare(
    `UPDATE messages SET ${stamp}delivery_state = ?
     WHERE id = ? AND (delivery_state IS NULL OR delivery_state NOT IN (${TERMINAL_STATES.map(() => "?").join(",")}))`,
  ).run(state, id, ...TERMINAL_STATES);
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
