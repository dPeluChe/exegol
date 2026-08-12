import type { Migration } from "../migrations";

/**
 * Wave 3 migrations (T156+). Id prefix `w3_`.
 */
export const wave3Migrations: Migration[] = [
  {
    // T160: user-editable session alias — addressing name for inter-agent
    // messaging (agent_send by name) and UI labels.
    id: "w3_001_agent_alias",
    sql: "ALTER TABLE agents ADD COLUMN alias TEXT;",
  },
  {
    // T162 phase 1: directed links — Exegol-enforced "when A's turn ends,
    // notify B (as role)". Fired from the turn-boundary choke point.
    id: "w3_002_agent_links",
    sql: `CREATE TABLE IF NOT EXISTS agent_links (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'notify' CHECK (role IN ('notify', 'reviewer', 'feedback')),
      note TEXT,
      once INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_links_from ON agent_links(from_agent_id);`,
  },
  {
    // T162 simplify: recreate agent_links WITH FK cascade — a bare
    // `DELETE FROM agents` (agents.delete) left orphan links that fireAgentLinks
    // would still read. Links are ephemeral (one session's lifetime), so
    // dropping any rows here is harmless. SQLite can't ADD a FK to an existing
    // table, hence the recreate.
    id: "w3_003_agent_links_fk",
    sql: `DROP TABLE IF EXISTS agent_links;
    CREATE TABLE agent_links (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'notify' CHECK (role IN ('notify', 'reviewer', 'feedback')),
      note TEXT,
      once INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_links_from ON agent_links(from_agent_id);`,
  },
];
