mod diff;
mod oplog;
mod types;

pub use diff::*;
pub use oplog::*;
pub use types::*;

use git2::{DiffOptions, Repository, StatusOptions};
use napi::Error;
use napi_derive::napi;
use std::path::Path;

/// Open a git repository at the given path, returning a napi::Error on failure.
fn open_repo(path: &str) -> Result<Repository, Error> {
  Repository::open(path).map_err(|e| Error::from_reason(format!("Failed to open repository at '{path}': {e}")))
}

/// Get repository information including current branch, remote URL, dirty state, and HEAD commit.
#[napi]
pub fn get_repo_info(path: String) -> Result<RepoInfo, Error> {
  let repo = open_repo(&path)?;

  // Current branch
  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {e}")))?;
  let current_branch = head
    .shorthand()
    .unwrap_or("HEAD (detached)")
    .to_string();

  // Remote URL (try "origin" first)
  let remote_url = repo
    .find_remote("origin")
    .ok()
    .and_then(|remote| remote.url().map(String::from));

  // Dirty state
  let mut status_opts = StatusOptions::new();
  status_opts
    .include_untracked(true)
    .recurse_untracked_dirs(true);
  let statuses = repo
    .statuses(Some(&mut status_opts))
    .map_err(|e| Error::from_reason(format!("Failed to get statuses: {e}")))?;
  let is_dirty = !statuses.is_empty();

  // HEAD commit info
  let head_commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD to commit: {e}")))?;
  let head_commit_sha = head_commit.id().to_string();
  let head_commit_message = head_commit
    .message()
    .unwrap_or("")
    .lines()
    .next()
    .unwrap_or("")
    .to_string();

  Ok(RepoInfo {
    current_branch,
    remote_url,
    is_dirty,
    head_commit_sha,
    head_commit_message,
  })
}

/// Create a new git worktree with a new branch.
///
/// If `target_path` is provided, the worktree is placed there.
/// Otherwise falls back to `<repo_path>/../<worktree_name>`.
/// A new branch `branch_name` is created pointing at the current HEAD.
#[napi]
pub fn create_worktree(
  repo_path: String,
  worktree_name: String,
  branch_name: String,
  target_path: Option<String>,
) -> Result<WorktreeInfo, Error> {
  let repo = open_repo(&repo_path)?;

  // Use explicit target path if provided, otherwise sibling directory
  let worktree_path = if let Some(ref tp) = target_path {
    let p = Path::new(tp);
    // Ensure parent directory exists
    if let Some(parent) = p.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|e| Error::from_reason(format!("Failed to create worktree directory: {e}")))?;
    }
    p.to_path_buf()
  } else {
    let repo_root = Path::new(&repo_path);
    repo_root.parent().unwrap_or(repo_root).join(&worktree_name)
  };
  let worktree_path_str = worktree_path
    .to_str()
    .ok_or_else(|| Error::from_reason("Invalid worktree path (non-UTF-8)"))?
    .to_string();

  // Get HEAD commit to base the new branch on
  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {e}")))?;
  let head_commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD to commit: {e}")))?;

  // Create the new branch
  let branch = repo
    .branch(&branch_name, &head_commit, false)
    .map_err(|e| Error::from_reason(format!("Failed to create branch '{branch_name}': {e}")))?;

  let branch_ref = branch
    .into_reference();
  let branch_ref_name = branch_ref
    .name()
    .ok_or_else(|| Error::from_reason("Branch reference name is not valid UTF-8"))?;

  // Create the worktree
  let reference = repo
    .find_reference(branch_ref_name)
    .map_err(|e| Error::from_reason(format!("Failed to find branch reference: {e}")))?;

  repo
    .worktree(
      &worktree_name,
      &worktree_path,
      Some(git2::WorktreeAddOptions::new().reference(Some(&reference))),
    )
    .map_err(|e| Error::from_reason(format!("Failed to create worktree '{worktree_name}': {e}")))?;

  Ok(WorktreeInfo {
    name: worktree_name,
    path: worktree_path_str,
    branch: branch_name,
    is_bare: false,
  })
}

/// Remove a git worktree. If `force` is true, removes even with uncommitted changes.
#[napi]
pub fn remove_worktree(
  repo_path: String,
  worktree_name: String,
  force: bool,
) -> Result<bool, Error> {
  let repo = open_repo(&repo_path)?;

  // Find the worktree
  let worktree = repo
    .find_worktree(&worktree_name)
    .map_err(|e| Error::from_reason(format!("Failed to find worktree '{worktree_name}': {e}")))?;
  let worktree_dir = worktree.path().to_path_buf();

  // Check if it's valid (has changes) when not forcing
  if !force && worktree.validate().is_err() {
    return Err(Error::from_reason(format!(
      "Worktree '{worktree_name}' has issues. Use force=true to remove anyway."
    )));
  }

  // If not forcing, check for uncommitted changes
  if !force {
    let wt_path = worktree
      .path()
      .to_str()
      .ok_or_else(|| Error::from_reason("Worktree path is not valid UTF-8"))?;

    if check_has_changes(wt_path)? {
      return Err(Error::from_reason(format!(
        "Worktree '{worktree_name}' has uncommitted changes. Use force=true to remove anyway."
      )));
    }
  }

  // Prune the worktree (removes from .git/worktrees)
  let mut opts = git2::WorktreePruneOptions::new();
  opts.working_tree(true).valid(true);
  if force {
    opts.locked(false);
  }
  worktree
    .prune(Some(&mut opts))
    .map_err(|e| Error::from_reason(format!("Failed to prune worktree '{worktree_name}': {e}")))?;

  // Remove the worktree directory from disk
  if worktree_dir.exists() {
    std::fs::remove_dir_all(&worktree_dir)
      .map_err(|e| Error::from_reason(format!("Failed to remove worktree directory: {e}")))?;
  }

  Ok(true)
}

/// Delete a local branch. Used by race mode (T131) to clean up loser
/// branches after their worktree has already been removed. `force` maps to
/// git2's `Branch::delete`, which does not check merge status itself — the
/// caller is expected to have already confirmed the worktree/branch is safe
/// to discard (e.g. no uncommitted changes).
#[napi]
pub fn delete_branch(repo_path: String, branch_name: String, force: bool) -> Result<bool, Error> {
  let repo = open_repo(&repo_path)?;

  let mut branch = repo
    .find_branch(&branch_name, git2::BranchType::Local)
    .map_err(|e| Error::from_reason(format!("Branch '{branch_name}' not found: {e}")))?;

  // git2's Branch::delete never checks merge status (always `-D` semantics).
  // Honor force=false with `-d` semantics: refuse when the branch tip is not
  // reachable from HEAD — its commits would be silently orphaned.
  if !force {
    let tip = branch
      .get()
      .target()
      .ok_or_else(|| Error::from_reason(format!("Branch '{branch_name}' has no target")))?;
    let head = repo
      .head()
      .ok()
      .and_then(|h| h.target())
      .ok_or_else(|| Error::from_reason("Failed to resolve HEAD".to_string()))?;
    let merged = repo.graph_descendant_of(head, tip).unwrap_or(false) || head == tip;
    if !merged {
      return Err(Error::from_reason(format!(
        "Branch '{branch_name}' is not merged into HEAD — pass force=true to delete anyway"
      )));
    }
  }

  branch
    .delete()
    .map_err(|e| Error::from_reason(format!("Failed to delete branch '{branch_name}': {e}")))?;

  Ok(true)
}

/// List all worktrees for a repository.
#[napi]
pub fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, Error> {
  let repo = open_repo(&repo_path)?;

  let worktree_names = repo
    .worktrees()
    .map_err(|e| Error::from_reason(format!("Failed to list worktrees: {e}")))?;

  let mut result = Vec::new();

  // Add the main worktree first
  let main_path = repo
    .workdir()
    .and_then(|p| p.to_str())
    .unwrap_or(&repo_path)
    .to_string();
  let main_branch = repo
    .head()
    .ok()
    .and_then(|h| h.shorthand().map(String::from))
    .unwrap_or_else(|| "HEAD".to_string());

  result.push(WorktreeInfo {
    name: "(main)".to_string(),
    path: main_path,
    branch: main_branch,
    is_bare: repo.is_bare(),
  });

  // Add each linked worktree
  for name in &worktree_names {
    let name = match name {
      Some(n) => n,
      None => continue,
    };

    let wt = match repo.find_worktree(name) {
      Ok(wt) => wt,
      Err(_) => continue,
    };

    let wt_path = wt
      .path()
      .to_str()
      .unwrap_or("")
      .to_string();

    // Try to determine the branch by opening the worktree as a repo
    let branch = Repository::open(&wt_path)
      .ok()
      .and_then(|wt_repo| {
        wt_repo
          .head()
          .ok()
          .and_then(|h| h.shorthand().map(String::from))
      })
      .unwrap_or_else(|| "unknown".to_string());

    result.push(WorktreeInfo {
      name: name.to_string(),
      path: wt_path,
      branch,
      is_bare: false,
    });
  }

  Ok(result)
}

/// Check if a worktree (or any repo working directory) has uncommitted changes.
#[napi]
pub fn worktree_has_changes(worktree_path: String) -> Result<bool, Error> {
  check_has_changes(&worktree_path)
}

/// Internal helper to check for uncommitted changes.
fn check_has_changes(path: &str) -> Result<bool, Error> {
  let repo = open_repo(path)?;

  let mut opts = StatusOptions::new();
  opts
    .include_untracked(true)
    .recurse_untracked_dirs(true)
    .include_ignored(false);

  let statuses = repo
    .statuses(Some(&mut opts))
    .map_err(|e| Error::from_reason(format!("Failed to get statuses: {e}")))?;

  Ok(!statuses.is_empty())
}

/// Get a unified diff of all changes (staged + unstaged + untracked) in a worktree.
#[napi]
pub fn get_worktree_diff(worktree_path: String) -> Result<String, Error> {
  let repo = open_repo(&worktree_path)?;

  let mut diff_opts = DiffOptions::new();
  diff_opts
    .include_untracked(true)
    .recurse_untracked_dirs(true);

  let head_tree = repo
    .head()
    .ok()
    .and_then(|h| h.peel_to_tree().ok());

  let diff = repo
    .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
    .map_err(|e| Error::from_reason(format!("Failed to compute diff: {e}")))?;

  let mut output = String::new();

  diff
    .print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
      let origin = line.origin();
      match origin {
        '+' | '-' | ' ' => output.push(origin),
        _ => {}
      }
      if let Ok(content) = std::str::from_utf8(line.content()) {
        output.push_str(content);
      }
      true
    })
    .map_err(|e| Error::from_reason(format!("Failed to format diff: {e}")))?;

  Ok(output)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use tempfile::TempDir;

  fn init_repo_with_branch(branch_name: &str) -> TempDir {
    let tmp = TempDir::new().unwrap();
    let repo = Repository::init(tmp.path()).unwrap();
    fs::write(tmp.path().join("a.txt"), "one\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();
    let sig = git2::Signature::now("Test", "test@local").unwrap();
    let commit_oid = repo
      .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
      .unwrap();
    let commit = repo.find_commit(commit_oid).unwrap();
    repo.branch(branch_name, &commit, false).unwrap();
    tmp
  }

  #[test]
  fn delete_branch_removes_local_branch() {
    let tmp = init_repo_with_branch("feature/loser");
    let path = tmp.path().to_string_lossy().into_owned();

    let deleted = delete_branch(path.clone(), "feature/loser".into(), true).unwrap();
    assert!(deleted);

    let repo = open_repo(&path).unwrap();
    assert!(repo.find_branch("feature/loser", git2::BranchType::Local).is_err());
  }

  #[test]
  fn delete_branch_errors_on_unknown_branch() {
    let tmp = init_repo_with_branch("feature/loser");
    let path = tmp.path().to_string_lossy().into_owned();

    assert!(delete_branch(path, "does-not-exist".into(), true).is_err());
  }
}
