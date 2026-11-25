import type { Migration } from "../migrations";
import { wave3EarlyMigrations } from "./wave3-early";

/**
 * Wave 3 migrations (T156+). Id prefix `w3_`.
 */
export const wave3Migrations: Migration[] = [
  ...wave3EarlyMigrations,
  {
    // Advisor, subagent, planner or editor models (MODEL_ROLES) as JSON, kept across a resume
    id: "w3_025_agent_model_roles",
    sql: "ALTER TABLE agents ADD COLUMN model_roles TEXT;",
  },
  {
    // T205: last input or output (ms), written at most every 5 min, for the idle sweep
    id: "w3_026_agent_last_activity_at",
    sql: "ALTER TABLE agents ADD COLUMN last_activity_at INTEGER;",
  },
  {
    // T202: a shell's last OSC 7 folder, where its resume reopens
    id: "w3_027_agent_last_cwd",
    sql: "ALTER TABLE agents ADD COLUMN last_cwd TEXT;",
  },
  {
    // T202: the session a resume continued, so a Watching pin follows the chain to the live one
    id: "w3_028_agent_resumed_from",
    sql: `ALTER TABLE agents ADD COLUMN resumed_from TEXT;
    CREATE INDEX IF NOT EXISTS idx_agents_resumed_from ON agents(resumed_from);`,
  },
  {
    // Browser panes: the user's "Always allow" / "Block" per project, origin and permission
    id: "w3_029_browser_permissions",
    sql: `CREATE TABLE IF NOT EXISTS browser_permissions (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      permission TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'block')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, origin, permission)
    );`,
  },
  {
    // Foreign keys without an index: every agent or project delete scanned these tables
    id: "w3_030_fk_indexes",
    sql: `CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON worktrees(agent_id);
    CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_agent ON handoffs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_successor ON handoffs(successor_agent_id);
    CREATE INDEX IF NOT EXISTS idx_task_queue_agent ON task_queue(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_source_agent ON memories(source_agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_links_to ON agent_links(to_agent_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_results_task ON scheduled_results(task_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_results_agent ON scheduled_results(agent_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_templates_project ON pipeline_templates(project_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_dictation_history_project ON dictation_history(project_id);`,
  },
  {
    // A resume started at its source's grid but stored none until the spawn grid was recorded;
    // a reattach then rebuilt its model at the 120x30 default
    id: "w3_031_resumed_pty_grid",
    sql: `UPDATE agents SET
      pty_cols = (SELECT s.pty_cols FROM agents s WHERE s.id = agents.resumed_from),
      pty_rows = (SELECT s.pty_rows FROM agents s WHERE s.id = agents.resumed_from)
    WHERE pty_cols IS NULL AND resumed_from IS NOT NULL;`,
  },
  {
    // Gitignore patterns of local files (.env) copied into a project's new worktrees; NULL = default
    id: "w3_032_project_worktree_copy",
    sql: "ALTER TABLE projects ADD COLUMN worktree_copy TEXT;",
  },
  {
    // Codex rows counted cached input as input: the first background import rewrites its window
    id: "w3_033_token_usage_cache",
    sql: `ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE token_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE token_usage ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'priced'
      CHECK (cost_source IN ('priced', 'reported', 'unpriced'));`,
  },
  {
    // Usage by session; clearing the import state rescans the window to fill existing rows
    id: "w3_034_token_usage_session",
    sql: `ALTER TABLE token_usage ADD COLUMN session_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_agents_claude_session ON agents(claude_session_id);
    DELETE FROM settings WHERE key = 'token_usage_import';`,
  },
  {
    // The repo a worktree was cut from: not the project root in a workspace of repos. Null: the root
    id: "w3_035_worktree_repo_path",
    sql: "ALTER TABLE worktrees ADD COLUMN repo_path TEXT;",
  },
  {
    // T217. agent_id and the rest are copied, no foreign keys: a message outlives its session
    id: "w3_036_inbox",
    sql: `
      CREATE TABLE inbox_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK (scope IN ('project', 'colab', 'personal')),
        scope_id TEXT,
        to_project TEXT,
        to_repo TEXT,
        kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'capture')),
        title TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
        resolution TEXT,
        owner_project TEXT,
        forwarded_from INTEGER,
        opened_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        last_turn INTEGER NOT NULL DEFAULT 0,
        refs TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX idx_inbox_threads_scope ON inbox_threads (scope, scope_id, status);
      CREATE TABLE inbox_messages (
        thread_id INTEGER NOT NULL REFERENCES inbox_threads (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent', 'external')),
        project_id TEXT,
        repo TEXT,
        agent_id TEXT,
        cli TEXT,
        model TEXT,
        branch TEXT,
        commit_sha TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, seq)
      );
      CREATE INDEX idx_inbox_messages_agent ON inbox_messages (agent_id, seq);
      CREATE TABLE inbox_reads (
        thread_id INTEGER NOT NULL REFERENCES inbox_threads (id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        last_read_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (thread_id, project_id)
      );
    `,
  },
  {
    // T217. Only a person creates a colab or changes its members. repo '' = the whole project
    id: "w3_037_colabs",
    sql: `
      CREATE TABLE colabs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        purpose TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE colab_members (
        colab_id TEXT NOT NULL REFERENCES colabs (id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        repo TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (colab_id, project_id, repo)
      );
      CREATE INDEX idx_colab_members_project ON colab_members (project_id);
    `,
  },
  {
    // T217 notes: the folder a project or colab got on first use, so a rename keeps it
    id: "w3_038_notes_dirs",
    sql: `
      ALTER TABLE projects ADD COLUMN notes_dir TEXT;
      ALTER TABLE colabs ADD COLUMN notes_dir TEXT;
    `,
  },
  {
    // T224. What the Commander did, kept for good: agent_events is pruned after 30 days
    id: "w3_039_commander_log",
    sql: `
      CREATE TABLE commander_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        outcome TEXT NOT NULL,
        summary TEXT,
        ref TEXT
      );
    `,
  },
  {
    // T224. A mark and note per reply read aloud, to compare voices over time; kept for good
    id: "w3_040_speech_feedback",
    sql: `
      CREATE TABLE speech_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        turn_id TEXT NOT NULL UNIQUE,
        rating TEXT NOT NULL,
        note TEXT,
        voice TEXT NOT NULL,
        speed REAL NOT NULL,
        model TEXT NOT NULL,
        spoken TEXT NOT NULL
      );
    `,
  },
  {
    // T224. Who writes to whom is read per pair of sessions, for the whole fleet
    id: "w3_041_messages_pair_index",
    sql: "CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_agent_id, to_agent_id);",
  },
  {
    // T224. The session the person marked as the project's main one; null = the oldest lineage
    id: "w3_042_project_main_agent",
    sql: "ALTER TABLE projects ADD COLUMN main_agent_id TEXT;",
  },
  {
    // JSON array of MCP server names its Claude Code sessions load besides Exegol; null = all
    id: "w3_043_project_mcp_servers",
    sql: "ALTER TABLE projects ADD COLUMN mcp_servers TEXT;",
  },
  {
    // The member that does the work the colab's threads ask for: the first to join, then the
    // person's pick. Colabs that existed get their first member
    id: "w3_044_colab_member_main",
    sql: `
      ALTER TABLE colab_members ADD COLUMN main INTEGER NOT NULL DEFAULT 0;
      UPDATE colab_members SET main = 1
        WHERE rowid IN (SELECT min(rowid) FROM colab_members GROUP BY colab_id);
      CREATE UNIQUE INDEX idx_colab_one_main ON colab_members (colab_id) WHERE main = 1;
    `,
  },
  {
    // A proposed close ('resolved' | 'dismissed') and its line, until the projects it waits
    // for agree or one answers; null otherwise
    id: "w3_045_inbox_closing",
    sql: `
      ALTER TABLE inbox_threads ADD COLUMN closing_status TEXT;
      ALTER TABLE inbox_threads ADD COLUMN closing_line TEXT;
    `,
  },
  {
    // The projects that agreed to a proposed close (JSON array of ids), the proposer first;
    // a close already waiting gets the project of its "Proposes to close" message
    id: "w3_046_inbox_closing_projects",
    sql: `
      ALTER TABLE inbox_threads ADD COLUMN closing_projects TEXT NOT NULL DEFAULT '[]';
      UPDATE inbox_threads SET closing_projects = COALESCE((
        SELECT json_array(m.project_id) FROM inbox_messages m
        WHERE m.thread_id = inbox_threads.id AND m.project_id IS NOT NULL
          AND m.body LIKE 'Proposes to close as %'
        ORDER BY m.seq DESC LIMIT 1), '[]')
      WHERE closing_status IS NOT NULL;
    `,
  },
  {
    // The name (alias) of the one session a thread is for, in the project it counts on; null
    // for any. A name, not an agent id: a resume makes a new row and keeps the name
    id: "w3_047_inbox_to_session",
    sql: "ALTER TABLE inbox_threads ADD COLUMN to_session TEXT;",
  },
  {
    // The name the session was last given inside its CLI (Claude's /rename), as Exegol last
    // read it: a new one moves the alias, a later alias set in Exegol stays
    id: "w3_048_agent_cli_name",
    sql: "ALTER TABLE agents ADD COLUMN cli_name TEXT;",
  },
  {
    id: "w3_049_colab_notices",
    sql: `
      ALTER TABLE colabs ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inbox_reads ADD COLUMN noticed_seq INTEGER NOT NULL DEFAULT 0;
    `,
  },
];
