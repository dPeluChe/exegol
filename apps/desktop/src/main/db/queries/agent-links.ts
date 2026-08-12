import type Database from "libsql";
import { nanoid } from "./helpers";

export type AgentLinkRole = "notify" | "reviewer" | "feedback";

export interface AgentLink {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  role: AgentLinkRole;
  note: string | null;
  once: boolean;
}

function mapLinkRow(row: Record<string, unknown>): AgentLink {
  return {
    id: row.id as string,
    fromAgentId: row.from_agent_id as string,
    toAgentId: row.to_agent_id as string,
    role: row.role as AgentLinkRole,
    note: (row.note as string) ?? null,
    once: Boolean(row.once),
  };
}

export function createAgentLink(
  db: Database.Database,
  data: {
    fromAgentId: string;
    toAgentId: string;
    role: AgentLinkRole;
    note?: string | null;
    once?: boolean;
  },
): AgentLink {
  const id = nanoid();
  db.prepare(
    `INSERT INTO agent_links (id, from_agent_id, to_agent_id, role, note, once)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.fromAgentId,
    data.toAgentId,
    data.role,
    data.note ?? null,
    data.once === false ? 0 : 1,
  );
  return {
    id,
    fromAgentId: data.fromAgentId,
    toAgentId: data.toAgentId,
    role: data.role,
    note: data.note ?? null,
    once: data.once !== false,
  };
}

export function listLinksFrom(db: Database.Database, fromAgentId: string): AgentLink[] {
  const rows = db
    .prepare("SELECT * FROM agent_links WHERE from_agent_id = ?")
    .all(fromAgentId) as Record<string, unknown>[];
  return rows.map(mapLinkRow);
}

export function deleteAgentLink(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM agent_links WHERE id = ?").run(id);
}

/** Links die with either endpoint — a link must never outlive its sessions. */
export function deleteLinksForAgent(db: Database.Database, agentId: string): void {
  db.prepare("DELETE FROM agent_links WHERE from_agent_id = ? OR to_agent_id = ?").run(
    agentId,
    agentId,
  );
}
