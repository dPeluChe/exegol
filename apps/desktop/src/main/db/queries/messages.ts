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
  },
): AgentMessage {
  const id = nanoid();
  db.prepare(
    `INSERT INTO messages (id, from_agent_id, to_agent_id, type, content)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, data.fromAgentId, data.toAgentId, data.type, data.content);
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
