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
  {
    // T181: session history. Sessions used to be DELETED at startup after a
    // day, cascading into scores, token usage and the oplog — so "what did I
    // run on this repo, with which agent" had no answer past 24h. Rows are kept
    // now; the tail of what the agent last said is kept with them, because a
    // score without the output is a number nobody can check.
    id: "w3_007_session_history",
    sql: `ALTER TABLE agents ADD COLUMN final_output TEXT;
    CREATE INDEX IF NOT EXISTS idx_agents_project_history
      ON agents(project_id, stopped_at DESC);
    /* The provider filter list is a DISTINCT cli_type per request; without this
       it scans a table that no longer gets purged. */
    CREATE INDEX IF NOT EXISTS idx_agents_project_cli
      ON agents(project_id, cli_type);`,
  },
  {
    id: "w3_008_pipeline_evidence_base",
    sql: `ALTER TABLE pipeline_runs ADD COLUMN evidence_path TEXT;
    ALTER TABLE pipeline_runs ADD COLUMN base_revision TEXT;`,
  },
  {
    // scoring.ts wrote these since tier 3 landed; without them every paid Haiku judge call was lost
    id: "w3_009_llm_score_columns",
    sql: `ALTER TABLE agent_scores ADD COLUMN llm_clarity INTEGER;
    ALTER TABLE agent_scores ADD COLUMN llm_completeness INTEGER;
    ALTER TABLE agent_scores ADD COLUMN llm_correctness INTEGER;
    ALTER TABLE agent_scores ADD COLUMN llm_score REAL;`,
  },
  {
    // T196: reattach rebuilt the terminal model at 120x30 and replayed a ring
    // written at the PTY's real size, so panes and mirrors got a reflowed mess
    id: "w3_010_agent_pty_size",
    sql: `ALTER TABLE agents ADD COLUMN pty_cols INTEGER;
    ALTER TABLE agents ADD COLUMN pty_rows INTEGER;`,
  },
  {
    // A per-launch YOLO choice was lost on resume: null = the provider's configured args
    id: "w3_011_agent_yolo",
    sql: "ALTER TABLE agents ADD COLUMN yolo INTEGER;",
  },
  {
    // Mute: alive but quiet (no attention, no notifications). Suspend: stopped
    // on purpose, kept for Resume, and quiet too
    id: "w3_012_agent_mute_suspend",
    sql: `ALTER TABLE agents ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agents ADD COLUMN suspended_at INTEGER;`,
  },
  {
    // Project identity in lists: a color, a built-in icon, or an image from the repo
    id: "w3_013_project_appearance",
    sql: `ALTER TABLE projects ADD COLUMN color TEXT;
    ALTER TABLE projects ADD COLUMN icon TEXT;
    ALTER TABLE projects ADD COLUMN icon_image TEXT;`,
  },
  {
    // A CLI typed in a plain terminal promotes the row to that agent; the shell stays below it
    id: "w3_014_launched_in_shell",
    sql: "ALTER TABLE agents ADD COLUMN launched_in_shell INTEGER NOT NULL DEFAULT 0;",
  },
  {
    // The CLI version a session started with: a newer binary on disk means "restart to update"
    id: "w3_015_agent_cli_version",
    sql: "ALTER TABLE agents ADD COLUMN cli_version TEXT;",
  },
  {
    // The model a session was launched with, so a resume or a restart onto an update keeps it
    id: "w3_016_agent_model",
    sql: "ALTER TABLE agents ADD COLUMN model TEXT;",
  },
  {
    // T142 phase 1: 0 = off, else the review-feedback cursor (ms) so a restart misses nothing
    id: "w3_017_agent_pr_watch",
    sql: "ALTER TABLE agents ADD COLUMN pr_watch INTEGER NOT NULL DEFAULT 0;",
  },
  {
    // Log-scan rows belong to a project, not an agent: agent_id NULL + project_id, both FKs
    // cascade. Old log_scan rows double-counted content blocks; the next scan restores them.
    id: "w3_018_token_usage_scan_key",
    sql: `CREATE TABLE token_usage_new (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      project_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'log_scan')),
      dedup_key TEXT UNIQUE,
      CHECK (agent_id IS NOT NULL OR project_id IS NOT NULL),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT INTO token_usage_new (id, agent_id, provider, model, input_tokens, output_tokens,
      estimated_cost_usd, tool_call_count, recorded_at, source)
      SELECT id, agent_id, provider, model, input_tokens, output_tokens,
        estimated_cost_usd, tool_call_count, recorded_at, source FROM token_usage
      WHERE source != 'log_scan' AND agent_id IN (SELECT id FROM agents);
    DROP TABLE token_usage;
    ALTER TABLE token_usage_new RENAME TO token_usage;
    CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_project ON token_usage(project_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_recorded ON token_usage(recorded_at);`,
  },
  {
    // T185.11: a run is its own row (queued, running, closed once) so a full slot defers it
    // durably and a timeout can never be followed by a second result for the same run
    id: "w3_019_scheduled_runs",
    sql: `ALTER TABLE scheduled_tasks ADD COLUMN timeout_minutes INTEGER;
    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT,
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'success', 'failure', 'timeout', 'budget_exceeded', 'skipped')),
      summary TEXT NOT NULL DEFAULT '',
      queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      ended_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task_state ON scheduled_runs(task_id, state);`,
  },
  {
    // Time in state that survives a restart. A trigger, so every status write sets it (ms)
    id: "w3_020_agent_status_changed_at",
    sql: `ALTER TABLE agents ADD COLUMN status_changed_at INTEGER;
    UPDATE agents SET status_changed_at = COALESCE(stopped_at, started_at) * 1000
    WHERE status NOT IN ('idle', 'spawning', 'running', 'waiting_input', 'paused');
    CREATE TRIGGER IF NOT EXISTS agents_status_changed_at
    AFTER UPDATE OF status ON agents WHEN NEW.status IS NOT OLD.status
    BEGIN
      UPDATE agents SET status_changed_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      WHERE id = NEW.id;
    END;`,
  },
  {
    // Agent browser: hosts beyond the local ones a project's agents may open (JSON array)
    id: "w3_021_project_browser_hosts",
    sql: "ALTER TABLE projects ADD COLUMN browser_hosts TEXT;",
  },
  {
    // Agent browser: browser_eval is opt-in per project
    id: "w3_022_project_browser_eval",
    sql: "ALTER TABLE projects ADD COLUMN browser_eval INTEGER NOT NULL DEFAULT 0;",
  },
  {
    // Per-project IDE, NULL = Settings' default. Replaces default_ide (NOT NULL, always 'vscode')
    // and the interim project_ides JSON setting, whose values move here once
    id: "w3_023_project_ide",
    sql: `ALTER TABLE projects ADD COLUMN ide TEXT;
    UPDATE projects SET ide = NULLIF(default_ide, 'vscode');
    UPDATE projects SET ide = COALESCE(
      json_extract((SELECT value FROM settings WHERE key = 'project_ides'), '$."' || id || '"'),
      ide)
    WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'project_ides' AND json_valid(value));
    DELETE FROM settings WHERE key = 'project_ides';`,
  },
];
