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
  {
    // T172: path claims. Two agents in one working tree had NO protection —
    // a coordinated round only avoided a collision because the human-facing
    // coordinator grepped before assigning (2026-08-13). Claims are held by a
    // live agent and die with it, exactly like links.
    id: "w3_004_path_claims",
    sql: `CREATE TABLE IF NOT EXISTS path_claims (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      /* Absolute, normalized path of a single concrete file or directory. A
         claim on globs is expanded before insert so overlap is a string
         comparison instead of glob-vs-glob reasoning. */
      path TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_path_claims_project ON path_claims(project_id, path);
    CREATE INDEX IF NOT EXISTS idx_path_claims_agent ON path_claims(agent_id);`,
  },
  {
    // T176: dismiss an ended session from the dashboard without losing it.
    // Archiving rather than deleting: the row carries the scoring, the oplog
    // attribution and the resume handle, and a list you cannot clear is a list
    // you stop reading.
    id: "w3_005_agent_archived_at",
    sql: "ALTER TABLE agents ADD COLUMN archived_at INTEGER;",
  },
  {
    // T170.1: delivery state survives a restart. It lived in a Map, so after a
    // relaunch `message_status` answered "unknown" for everything and a retry
    // with the same client_key re-delivered — precisely when a sender most
    // needs the answer. The unique index makes idempotency a constraint rather
    // than a lookup that a process death forgets.
    id: "w3_006_message_delivery",
    sql: `ALTER TABLE messages ADD COLUMN delivery_state TEXT;
    ALTER TABLE messages ADD COLUMN client_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_key
      ON messages(from_agent_id, client_key) WHERE client_key IS NOT NULL;
    /* Messages are never deleted, so the startup sweep would scan a table that
       only grows. Partial: it indexes the handful that are actually stranded. */
    CREATE INDEX IF NOT EXISTS idx_messages_queued
      ON messages(delivery_state) WHERE delivery_state = 'queued';`,
  },
];
