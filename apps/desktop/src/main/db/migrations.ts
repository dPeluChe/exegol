import type Database from "libsql";
import { wave2KnowledgeMigrations } from "./migration-sets/wave2-knowledge";
import { wave2SignalMigrations } from "./migration-sets/wave2-signal";
import { wave2SurfaceMigrations } from "./migration-sets/wave2-surface";

export type Migration = {
  id: string;
  sql: string;
};

// Wave 2: each work group appends ONLY to its own migration-sets/ file
// (w2a_/w2b_/w2d_ id prefixes) — this array stays conflict-free.
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
  {
    id: "015_handoffs",
    sql: `CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      successor_agent_id TEXT,
      goal TEXT NOT NULL,
      progress TEXT NOT NULL DEFAULT '',
      files_modified TEXT NOT NULL DEFAULT '',
      next_steps TEXT NOT NULL DEFAULT '',
      critical_context TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (successor_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    )`,
  },
  {
    id: "016_messages",
    sql: `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT,
      to_agent_id TEXT,
      type TEXT NOT NULL DEFAULT 'text'
        CHECK (type IN ('text', 'handoff', 'status', 'request', 'result')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      read_at INTEGER,
      FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE SET NULL,
      FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_messages_from_agent ON messages(from_agent_id)`,
  },
  {
    id: "017_scheduled_tasks_depends_on",
    sql: `ALTER TABLE scheduled_tasks ADD COLUMN depends_on TEXT`,
  },
  {
    id: "018_task_queue",
    sql: `CREATE TABLE IF NOT EXISTS task_queue (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cli_type TEXT NOT NULL DEFAULT 'claude-code',
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'blocked', 'completed', 'failed', 'cancelled')),
      depends_on TEXT,
      agent_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_queue_project ON task_queue(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status)`,
  },
  {
    id: "019_skills_state",
    sql: `CREATE TABLE IF NOT EXISTS skills_state (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, skill_name)
    )`,
  },
  {
    id: "020_memories",
    sql: `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('preference', 'pattern', 'error', 'solution', 'dependency', 'convention')),
      content TEXT NOT NULL,
      source_agent_id TEXT,
      relevance_score REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(project_id, category);
    CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(project_id, relevance_score DESC)`,
  },
  {
    id: "021_agent_scores",
    sql: `CREATE TABLE IF NOT EXISTS agent_scores (
      agent_id TEXT PRIMARY KEY,
      files_changed INTEGER NOT NULL DEFAULT 0,
      compiles INTEGER, -- null = unknown, 0 = false, 1 = true
      tests_passed INTEGER, -- null = unknown, 0 = false, 1 = true
      task_completed INTEGER NOT NULL DEFAULT 0,
      exit_code INTEGER NOT NULL DEFAULT 0,
      exit_reason TEXT NOT NULL DEFAULT 'unknown'
        CHECK (exit_reason IN ('success', 'failure', 'stopped', 'timeout', 'unknown')),
      turns_used INTEGER NOT NULL DEFAULT 0,
      tokens_spent INTEGER NOT NULL DEFAULT 0,
      files_modified_count INTEGER NOT NULL DEFAULT 0,
      overall_score REAL NOT NULL DEFAULT 0.0,
      scored_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_scores_score ON agent_scores(overall_score);
    CREATE INDEX IF NOT EXISTS idx_agent_scores_scored_at ON agent_scores(scored_at)`,
  },
  {
    id: "022_oplog",
    sql: `CREATE TABLE IF NOT EXISTS oplog (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      operation TEXT NOT NULL
        CHECK (operation IN ('commit', 'branch_create', 'worktree_create', 'file_write', 'revert')),
      ref_before TEXT, -- SHA or branch ref before the operation
      ref_after TEXT,  -- SHA or branch ref after the operation
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oplog_agent ON oplog(agent_id);
    CREATE INDEX IF NOT EXISTS idx_oplog_project ON oplog(project_id);
    CREATE INDEX IF NOT EXISTS idx_oplog_created ON oplog(created_at DESC)`,
  },
  {
    id: "024_pipeline",
    sql: `CREATE TABLE IF NOT EXISTS pipeline_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
      current_step_index INTEGER NOT NULL DEFAULT 0,
      step_results TEXT NOT NULL DEFAULT '[]',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 5,
      original_task TEXT NOT NULL DEFAULT '',
      worktree_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (template_id) REFERENCES pipeline_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_template ON pipeline_runs(template_id)`,
  },
  {
    id: "023_agents_add_crashed_status",
    sql: `
      CREATE TABLE IF NOT EXISTS agents_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        worktree_id TEXT,
        cli_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle'
          CHECK (status IN ('idle', 'spawning', 'running', 'waiting_input', 'paused', 'completed', 'failed', 'stopped', 'crashed')),
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
    id: "025_agents_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_project_status ON agents(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
    `,
  },
  {
    id: "026_agents_session_id",
    sql: `ALTER TABLE agents ADD COLUMN session_id TEXT;`,
  },
  {
    id: "027_agent_events",
    sql: `CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent_id, created_at);`,
  },
  {
    id: "028_projects_sort_order",
    sql: `ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    id: "029_agents_access_mode",
    sql: `ALTER TABLE agents ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'write';`,
  },
  {
    id: "030_project_indexing",
    sql: `
      CREATE TABLE IF NOT EXISTS file_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        language TEXT,
        chunk_count INTEGER DEFAULT 0,
        indexed_at INTEGER,
        UNIQUE(project_id, path)
      );

      CREATE TABLE IF NOT EXISTS file_chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES file_index(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding BLOB,
        start_line INTEGER,
        end_line INTEGER,
        chunk_type TEXT DEFAULT 'block'
      );

      CREATE INDEX IF NOT EXISTS idx_file_index_project ON file_index(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_id);
    `,
  },
  {
    id: "032_agents_claude_session_id",
    sql: `ALTER TABLE agents ADD COLUMN claude_session_id TEXT;`,
  },
  {
    id: "033_agents_resume_command",
    sql: `ALTER TABLE agents ADD COLUMN resume_command TEXT;`,
  },
  {
    id: "034_parallel_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS parallel_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_description TEXT NOT NULL,
        cli_types TEXT NOT NULL DEFAULT '[]',
        agent_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'running',
        promoted_agent_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_parallel_runs_project
        ON parallel_runs(project_id);

      ALTER TABLE agents ADD COLUMN parallel_run_id TEXT;
    `,
  },
  {
    id: "035_qa_tests",
    sql: `
      CREATE TABLE IF NOT EXISTS qa_tests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_url TEXT NOT NULL,
        actions TEXT NOT NULL DEFAULT '[]',
        action_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_run_at INTEGER,
        last_status TEXT NOT NULL DEFAULT 'saved'
      );

      CREATE INDEX IF NOT EXISTS idx_qa_tests_project ON qa_tests(project_id);

      CREATE TABLE IF NOT EXISTS qa_test_runs (
        id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL REFERENCES qa_tests(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running',
        step_results TEXT NOT NULL DEFAULT '[]',
        console_errors TEXT NOT NULL DEFAULT '[]',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_qa_test_runs_test ON qa_test_runs(test_id);
    `,
  },
  {
    id: "031_diff_comments",
    sql: `
      CREATE TABLE IF NOT EXISTS diff_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT,
        file_path TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        hunk_index INTEGER,
        content TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_diff_comments_project_file
        ON diff_comments(project_id, file_path);
    `,
  },
  {
    id: "036_agents_isolation_mode",
    sql: `ALTER TABLE agents ADD COLUMN isolation_mode TEXT;`,
  },
  ...wave2SignalMigrations,
  ...wave2KnowledgeMigrations,
  ...wave2SurfaceMigrations,
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
