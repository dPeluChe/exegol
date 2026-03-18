import type Database from "libsql";

type Migration = {
  id: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    id: "001_projects",
    sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      default_branch TEXT NOT NULL DEFAULT 'main',
      default_ide TEXT NOT NULL DEFAULT 'vscode',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_opened_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  },
  {
    id: "002_agents",
    sql: `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_id TEXT,
      cli_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'spawning', 'running', 'waiting_input', 'paused', 'completed', 'failed')),
      task_description TEXT NOT NULL,
      current_step TEXT,
      pid INTEGER,
      started_at INTEGER,
      stopped_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`,
  },
  {
    id: "003_worktrees",
    sql: `CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT,
      path TEXT NOT NULL UNIQUE,
      branch_name TEXT NOT NULL,
      auto_cleanup INTEGER NOT NULL DEFAULT 1,
      disk_usage_bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    )`,
  },
  {
    id: "004_sessions",
    sql: `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      layout_state TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`,
  },
  {
    id: "005_scheduled_tasks",
    sql: `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      skill_name TEXT,
      cli_agent TEXT NOT NULL DEFAULT 'claude-code',
      max_token_budget INTEGER,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_result_status TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'timeout', 'budget_exceeded')),
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )`,
  },
  {
    id: "006_token_usage",
    sql: `CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_recorded ON token_usage(recorded_at)`,
  },
  {
    id: "007_port_registry",
    sql: `CREATE TABLE IF NOT EXISTS port_registry (
      id TEXT PRIMARY KEY,
      worktree_id TEXT NOT NULL,
      port INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('config_parsed', 'runtime_detected')),
      status TEXT NOT NULL DEFAULT 'configured'
        CHECK (status IN ('configured', 'listening', 'idle', 'conflict')),
      detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_port_registry_worktree ON port_registry(worktree_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_port_registry_port ON port_registry(port, worktree_id)`,
  },
  {
    id: "008_host_metrics",
    sql: `CREATE TABLE IF NOT EXISTS host_metrics (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cpu_percent REAL NOT NULL DEFAULT 0.0,
      memory_bytes INTEGER NOT NULL DEFAULT 0,
      disk_bytes INTEGER NOT NULL DEFAULT 0,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_host_metrics_agent ON host_metrics(agent_id);
    CREATE INDEX IF NOT EXISTS idx_host_metrics_recorded ON host_metrics(recorded_at)`,
  },
  {
    id: "009_settings",
    sql: `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
  {
    id: "010_agents_add_stopped_status",
    sql: `
      -- SQLite doesn't support ALTER CHECK constraint, so we recreate the table
      CREATE TABLE IF NOT EXISTS agents_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        worktree_id TEXT,
        cli_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle'
          CHECK (status IN ('idle', 'spawning', 'running', 'waiting_input', 'paused', 'completed', 'failed', 'stopped')),
        task_description TEXT NOT NULL,
        current_step TEXT,
        pid INTEGER,
        started_at INTEGER,
        stopped_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO agents_new SELECT * FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
    `,
  },
  {
    id: "011_prompts",
    sql: `CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom'
        CHECK (category IN ('task', 'review', 'debug', 'custom')),
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`,
  },
  {
    id: "012_token_usage_source",
    sql: `ALTER TABLE token_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'agent'
      CHECK (source IN ('agent', 'log_scan'))`,
  },
  {
    id: "013_activities",
    sql: `CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      project_id TEXT,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id);
    CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type)`,
  },
  {
    id: "014_search_fts5",
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        title,
        body,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        project_id UNINDEXED,
        agent_id UNINDEXED,
        indexed_at UNINDEXED,
        tokenize='porter unicode61'
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const appliedStmt = db.prepare("SELECT id FROM _migrations WHERE id = ?");
  const insertStmt = db.prepare("INSERT INTO _migrations (id) VALUES (?)");

  const runInTransaction = db.transaction(() => {
    for (const migration of migrations) {
      const existing = appliedStmt.get(migration.id) as { id: string } | undefined;
      if (existing) continue;

      db.exec(migration.sql);
      insertStmt.run(migration.id);
    }
  });

  runInTransaction();
}
