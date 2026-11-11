import type { AgentMessage, AgentMessageType, MessageDeliveryState } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

const marks = (ids: string[]) => ids.map(() => "?").join(",");

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
     WHERE id IN (${marks(ids)})
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

// ─── Talk between sessions (T224) ────────────────────────────────────────────

export interface TalkPair {
  fromId: string;
  toId: string;
  /** Seconds, of the pair's newest message in this direction */
  at: number;
  seq: number;
}

/** The newest message per ordered pair among `ids`, since `sinceSec` */
export function listTalkPairs(db: Database.Database, ids: string[], sinceSec: number): TalkPair[] {
  if (ids.length < 2) return [];
  return db
    .prepare(
      `SELECT from_agent_id AS fromId, to_agent_id AS toId,
              MAX(created_at) AS at, MAX(rowid) AS seq
       FROM messages
       WHERE created_at >= ?
         AND from_agent_id IN (${marks(ids)}) AND to_agent_id IN (${marks(ids)})
       GROUP BY from_agent_id, to_agent_id`,
    )
    .all(sinceSec, ...ids, ...ids) as TalkPair[];
}

export interface NewTalk {
  fromId: string;
  toId: string;
  chars: number;
  /** The pair's message before this one went the other way, in the 24 hours before it */
  answered: boolean;
}

export function messageCursor(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS top FROM messages").get() as {
    top: number;
  };
  return row.top;
}

/** Messages among `ids` written after `afterRow`, oldest first; never their text */
export function listTalkSince(db: Database.Database, ids: string[], afterRow: number): NewTalk[] {
  if (ids.length < 2) return [];
  const rows = db
    .prepare(
      `SELECT m.from_agent_id AS fromId, m.to_agent_id AS toId, LENGTH(m.content) AS chars,
              COALESCE((SELECT MAX(p.rowid) FROM messages p
                        WHERE p.from_agent_id = m.to_agent_id AND p.to_agent_id = m.from_agent_id
                          AND p.rowid < m.rowid AND p.created_at >= m.created_at - 86400), 0)
              > COALESCE((SELECT MAX(p.rowid) FROM messages p
                          WHERE p.from_agent_id = m.from_agent_id AND p.to_agent_id = m.to_agent_id
                            AND p.rowid < m.rowid), 0) AS answered
       FROM messages m
       WHERE m.rowid > ?
         AND m.from_agent_id IN (${marks(ids)}) AND m.to_agent_id IN (${marks(ids)})
       ORDER BY m.rowid ASC`,
    )
    .all(afterRow, ...ids, ...ids) as (Omit<NewTalk, "answered"> & { answered: number })[];
  return rows.map((r) => ({ ...r, answered: r.answered === 1 }));
}

/** Between two sessions whose rows exist: both ids and their names are known */
export type SessionMessage = Omit<AgentMessage, "fromAgentId" | "toAgentId"> & {
  fromAgentId: string;
  toAgentId: string;
  fromAlias: string | null;
  toAlias: string | null;
};

// Inner joins: a message with no sender (a system notice) is not talk between sessions
const SESSION_MESSAGE = `SELECT m.*, fa.alias AS from_alias, ta.alias AS to_alias
  FROM messages m
  JOIN agents fa ON fa.id = m.from_agent_id
  JOIN agents ta ON ta.id = m.to_agent_id`;

const mapSessionMessage = (row: Record<string, unknown>): SessionMessage => ({
  ...mapMessageRow(row),
  fromAgentId: row.from_agent_id as string,
  toAgentId: row.to_agent_id as string,
  fromAlias: (row.from_alias as string) ?? null,
  toAlias: (row.to_alias as string) ?? null,
});

/** The newest messages `agentId` sent or received (with `withId` only, when given), oldest first */
export function listSessionMessages(
  db: Database.Database,
  agentId: string,
  withId: string | null,
  limit: number,
): SessionMessage[] {
  const rows = db
    .prepare(
      `${SESSION_MESSAGE}
       WHERE (m.from_agent_id = ?1 AND (?2 IS NULL OR m.to_agent_id = ?2))
          OR (m.to_agent_id = ?1 AND (?2 IS NULL OR m.from_agent_id = ?2))
       ORDER BY m.rowid DESC LIMIT ?3`,
    )
    .all(agentId, withId, limit);
  return (rows as Record<string, unknown>[]).map(mapSessionMessage).reverse();
}

export function getSessionMessage(db: Database.Database, id: string): SessionMessage | null {
  const row = db.prepare(`${SESSION_MESSAGE} WHERE m.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSessionMessage(row) : null;
}
