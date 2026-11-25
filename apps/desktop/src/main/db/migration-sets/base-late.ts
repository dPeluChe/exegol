import type { Migration } from "../migrations";

/** Base migrations from 020 on, in the order they have always run */
export const baseLateMigrations: Migration[] = [
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
];
