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
