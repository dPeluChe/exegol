use napi_derive::napi;

/// Information about a git repository.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct RepoInfo {
  /// Name of the current branch (e.g. "main").
  pub current_branch: String,
  /// Remote URL if configured (e.g. "https://github.com/user/repo.git").
  pub remote_url: Option<String>,
  /// Whether the working directory has uncommitted changes.
  pub is_dirty: bool,
  /// SHA of the HEAD commit.
  pub head_commit_sha: String,
  /// First line of the HEAD commit message.
  pub head_commit_message: String,
}

/// Information about a git worktree.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct WorktreeInfo {
  /// Name of the worktree.
  pub name: String,
  /// Absolute filesystem path of the worktree.
  pub path: String,
  /// Branch the worktree is checked out on.
  pub branch: String,
  /// Whether this is the bare/main worktree.
  pub is_bare: bool,
}

// ─── Diff types (T28) ──────────────────────────────────────────────────────

/// A single line in a diff hunk.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct DiffLine {
  /// Line content (without leading +/-/ prefix).
  pub content: String,
  /// Line type: "addition", "deletion", or "context".
  pub line_type: String,
  /// Line number in the old file (null for additions).
  pub old_lineno: Option<u32>,
  /// Line number in the new file (null for deletions).
  pub new_lineno: Option<u32>,
}

/// A contiguous section of changes within a file.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct DiffHunk {
  /// Starting line number in the old file.
  pub old_start: u32,
  /// Number of lines in the old file.
  pub old_lines: u32,
  /// Starting line number in the new file.
  pub new_start: u32,
  /// Number of lines in the new file.
  pub new_lines: u32,
  /// Optional hunk header text (e.g. function name).
  pub header: String,
  /// Lines in this hunk.
  pub lines: Vec<DiffLine>,
}

/// A file that has changes.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct FileDiff {
  /// File path (new path for renames/additions, old path for deletions).
  pub path: String,
  /// Old file path (for renames).
  pub old_path: Option<String>,
  /// File status: "added", "modified", "deleted", "renamed".
  pub status: String,
  /// Whether this is a binary file.
  pub binary: bool,
  /// Diff hunks for this file.
  pub hunks: Vec<DiffHunk>,
}

// ─── Oplog types (T29) ─────────────────────────────────────────────────────

/// A snapshot of the repo state at a point in time.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct RepoSnapshot {
  /// HEAD commit SHA.
  pub head_sha: String,
  /// Current branch name.
  pub branch: String,
  /// Timestamp (unix seconds).
  pub timestamp: i64,
}

// ─── Oplog v2 types (T129 — GitButler-style per-turn tree snapshots) ──────

/// An in-memory tree built from the current index + worktree, not yet
/// committed. `commit_turn_snapshot` only writes it to the hidden ref chain
/// if the caller's operation actually succeeded (unmaterialized pattern).
#[napi(object)]
#[derive(Debug, Clone)]
pub struct PreparedTurnSnapshot {
  /// SHA of the tree object already written to the odb.
  pub tree_sha: String,
  /// SHA of the current tip of the hidden oplog chain, if any.
  pub parent_sha: Option<String>,
}

/// A committed turn snapshot in the hidden oplog chain (`refs/exegol/oplog`).
#[napi(object)]
#[derive(Debug, Clone)]
pub struct OplogSnapshotInfo {
  /// Commit SHA of this snapshot.
  pub sha: String,
  /// Parent snapshot SHA in the chain, if any.
  pub parent_sha: Option<String>,
  /// Trailer: operation kind (e.g. "AgentTurn", "PipelineStep", "Promote").
  pub operation: String,
  /// Trailer: agent id that produced this turn.
  pub agent_id: String,
  /// Trailer: CLI provider (e.g. "claude-code", "codex").
  pub provider: String,
  /// Trailer: 0-based turn index for this agent.
  pub turn_index: i64,
  /// Free-text description (commit body, after trailers).
  pub description: String,
  /// Commit timestamp (unix seconds).
  pub timestamp: i64,
}
