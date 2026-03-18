use super::open_repo;
use super::types::*;
use napi::Error;
use napi_derive::napi;

/// Get the current repo snapshot (HEAD sha + branch + timestamp).
#[napi]
pub fn get_repo_snapshot(repo_path: String) -> Result<RepoSnapshot, Error> {
  let repo = open_repo(&repo_path)?;

  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {}", e)))?;

  let branch = head
    .shorthand()
    .unwrap_or("HEAD (detached)")
    .to_string();

  let commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD to commit: {}", e)))?;

  let head_sha = commit.id().to_string();
  let timestamp = commit.time().seconds();

  Ok(RepoSnapshot {
    head_sha,
    branch,
    timestamp,
  })
}

/// Revert to a specific commit by creating a new commit that restores its tree.
/// Never force-pushes — creates a new "revert" commit on current branch.
#[napi]
pub fn revert_to_snapshot(repo_path: String, target_sha: String) -> Result<String, Error> {
  let repo = open_repo(&repo_path)?;

  // Find the target commit
  let target_oid = git2::Oid::from_str(&target_sha)
    .map_err(|e| Error::from_reason(format!("Invalid SHA '{}': {}", target_sha, e)))?;
  let target_commit = repo
    .find_commit(target_oid)
    .map_err(|e| Error::from_reason(format!("Commit '{}' not found: {}", target_sha, e)))?;
  let target_tree = target_commit
    .tree()
    .map_err(|e| Error::from_reason(format!("Failed to get tree: {}", e)))?;

  // Get current HEAD as parent
  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {}", e)))?;
  let head_commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD: {}", e)))?;

  // Create signature
  let sig = repo
    .signature()
    .or_else(|_| git2::Signature::now("Exegol", "exegol@local"))
    .map_err(|e| Error::from_reason(format!("Failed to create signature: {}", e)))?;

  // Create a new commit with the target tree on top of current HEAD
  let short_sha: String = target_sha.chars().take(8).collect();
  let message = format!("Revert to {}", short_sha);
  let new_oid = repo
    .commit(
      Some("HEAD"),
      &sig,
      &sig,
      &message,
      &target_tree,
      &[&head_commit],
    )
    .map_err(|e| Error::from_reason(format!("Failed to create revert commit: {}", e)))?;

  // Checkout the new tree to update working directory
  repo
    .checkout_tree(
      target_tree.as_object(),
      Some(git2::build::CheckoutBuilder::new().force()),
    )
    .map_err(|e| Error::from_reason(format!("Failed to checkout tree: {}", e)))?;

  Ok(new_oid.to_string())
}
