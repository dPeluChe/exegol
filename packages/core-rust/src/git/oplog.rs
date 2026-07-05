use super::open_repo;
use super::types::{OplogSnapshotInfo, PreparedTurnSnapshot, RepoSnapshot};
use git2::{IndexAddOption, Oid, Repository, Signature};
use napi::Error;
use napi_derive::napi;

/// Get the current repo snapshot (HEAD sha + branch + timestamp).
#[napi]
pub fn get_repo_snapshot(repo_path: String) -> Result<RepoSnapshot, Error> {
  let repo = open_repo(&repo_path)?;

  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {e}")))?;

  let branch = head
    .shorthand()
    .unwrap_or("HEAD (detached)")
    .to_string();

  let commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD to commit: {e}")))?;

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
pub fn revert_to_snapshot(
  repo_path: String,
  target_sha: String,
  remove_untracked: Option<bool>,
) -> Result<String, Error> {
  let repo = open_repo(&repo_path)?;
  // Default FALSE: v1 oplog undo predates turn snapshots — untracked files
  // were never captured anywhere, so deleting them here would be data loss.
  // Turn-snapshot restore opts in (its snapshots DO capture untracked files).
  let remove_untracked = remove_untracked.unwrap_or(false);

  // Find the target commit
  let target_oid = git2::Oid::from_str(&target_sha)
    .map_err(|e| Error::from_reason(format!("Invalid SHA '{target_sha}': {e}")))?;
  let target_commit = repo
    .find_commit(target_oid)
    .map_err(|e| Error::from_reason(format!("Commit '{target_sha}' not found: {e}")))?;
  let target_tree = target_commit
    .tree()
    .map_err(|e| Error::from_reason(format!("Failed to get tree: {e}")))?;

  // Get current HEAD as parent
  let head = repo
    .head()
    .map_err(|e| Error::from_reason(format!("Failed to get HEAD: {e}")))?;
  let head_commit = head
    .peel_to_commit()
    .map_err(|e| Error::from_reason(format!("Failed to peel HEAD: {e}")))?;

  // Create signature
  let sig = repo
    .signature()
    .or_else(|_| git2::Signature::now("Exegol", "exegol@local"))
    .map_err(|e| Error::from_reason(format!("Failed to create signature: {e}")))?;

  // Create a new commit with the target tree on top of current HEAD
  let short_sha: String = target_sha.chars().take(8).collect();
  let message = format!("Revert to {short_sha}");
  let new_oid = repo
    .commit(
      Some("HEAD"),
      &sig,
      &sig,
      &message,
      &target_tree,
      &[&head_commit],
    )
    .map_err(|e| Error::from_reason(format!("Failed to create revert commit: {e}")))?;

  // Checkout the new tree to update working directory
  let mut checkout = git2::build::CheckoutBuilder::new();
  checkout.force();
  if remove_untracked {
    checkout.remove_untracked(true);
  }
  repo
    .checkout_tree(target_tree.as_object(), Some(&mut checkout))
    .map_err(|e| Error::from_reason(format!("Failed to checkout tree: {e}")))?;

  Ok(new_oid.to_string())
}

// ─── Oplog v2 (T129) ────────────────────────────────────────────────────────
//
// Snapshots live on a hidden ref chain (`refs/exegol/oplog`) outside
// `refs/heads/*`, so they never show up as branches and never touch the
// user's HEAD, index file, or staging area. Each snapshot is a commit whose
// tree captures the full worktree + index state at turn boundary; the chain
// is its own independent parent-child history, separate from the visible
// branch. Metadata (operation kind, agent id, provider, turn index) is
// carried as trailers in the commit message, mirroring GitButler's
// `SnapshotDetails` / `OperationKind` model.

const HIDDEN_REF: &str = "refs/exegol/oplog";

fn hidden_ref_target(repo: &Repository) -> Option<Oid> {
  repo.find_reference(HIDDEN_REF).ok()?.target()
}

fn signature(repo: &Repository) -> Result<Signature<'static>, Error> {
  repo
    .signature()
    .or_else(|_| Signature::now("Exegol", "exegol@local"))
    .map_err(|e| Error::from_reason(format!("Failed to create signature: {e}")))
}

/// Move the hidden ref to `target`, forging a reflog entry so the chain's
/// history survives ref updates even without `core.logAllRefUpdates`
/// (GitButler's `reflog.rs` anti-GC trick — the ref keeps every ancestor
/// commit reachable, the reflog additionally records the move itself).
fn update_hidden_ref(repo: &Repository, target: Oid, msg: &str) -> Result<(), Error> {
  match repo.find_reference(HIDDEN_REF) {
    Ok(mut r) => {
      r.set_target(target, msg)
        .map_err(|e| Error::from_reason(format!("Failed to move hidden oplog ref: {e}")))?;
    }
    Err(_) => {
      repo
        .reference(HIDDEN_REF, target, false, msg)
        .map_err(|e| Error::from_reason(format!("Failed to create hidden oplog ref: {e}")))?;
    }
  }

  let sig = signature(repo)?;
  let mut reflog = repo
    .reflog(HIDDEN_REF)
    .map_err(|e| Error::from_reason(format!("Failed to open oplog reflog: {e}")))?;
  reflog
    .append(target, &sig, Some(msg))
    .map_err(|e| Error::from_reason(format!("Failed to append oplog reflog entry: {e}")))?;
  reflog
    .write()
    .map_err(|e| Error::from_reason(format!("Failed to write oplog reflog: {e}")))?;

  Ok(())
}

/// Build a tree from the current index + worktree without persisting
/// anything to disk (`prepare_snapshot` half of the unmaterialized pattern).
/// `index.add_all`/`update_all` mutate only the in-memory `Index` handle —
/// the real `.git/index` file is untouched unless `index.write()` is called,
/// which we deliberately never do here.
#[napi]
pub fn prepare_turn_snapshot(repo_path: String) -> Result<PreparedTurnSnapshot, Error> {
  let repo = open_repo(&repo_path)?;

  let mut index = repo
    .index()
    .map_err(|e| Error::from_reason(format!("Failed to open index: {e}")))?;
  index
    .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
    .map_err(|e| Error::from_reason(format!("Failed to stage worktree for snapshot: {e}")))?;
  index
    .update_all(["*"].iter(), None)
    .map_err(|e| Error::from_reason(format!("Failed to reconcile deletions for snapshot: {e}")))?;

  let tree_oid = index
    .write_tree_to(&repo)
    .map_err(|e| Error::from_reason(format!("Failed to write snapshot tree: {e}")))?;

  Ok(PreparedTurnSnapshot {
    tree_sha: tree_oid.to_string(),
    parent_sha: hidden_ref_target(&repo).map(|o| o.to_string()),
  })
}

/// Commit a previously prepared tree onto the hidden oplog chain
/// (`commit_snapshot` half of the unmaterialized pattern) — call this only
/// when the agent turn actually succeeded; on failure, simply discard the
/// prepared snapshot and nothing is ever written to the chain.
#[napi]
#[allow(clippy::too_many_arguments)]
pub fn commit_turn_snapshot(
  repo_path: String,
  tree_sha: String,
  operation: String,
  agent_id: String,
  provider: String,
  turn_index: i64,
  description: String,
) -> Result<OplogSnapshotInfo, Error> {
  let repo = open_repo(&repo_path)?;

  let tree_oid = Oid::from_str(&tree_sha)
    .map_err(|e| Error::from_reason(format!("Invalid tree SHA '{tree_sha}': {e}")))?;
  let tree = repo
    .find_tree(tree_oid)
    .map_err(|e| Error::from_reason(format!("Snapshot tree not found: {e}")))?;

  let sig = signature(&repo)?;
  let parent_oid = hidden_ref_target(&repo);
  let parent_commit = parent_oid
    .map(|oid| repo.find_commit(oid))
    .transpose()
    .map_err(|e| Error::from_reason(format!("Failed to resolve oplog chain parent: {e}")))?;
  let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

  // Single-line-sanitize trailer/description inputs: a step label containing
  // "\n\n" would shift the fixed title/trailers/description message layout.
  let description = description.replace('\n', " ");
  let message = format!(
    "Agent turn snapshot\n\noperation: {operation}\nagent-id: {agent_id}\nprovider: {provider}\nturn-index: {turn_index}\nworktree-path: {repo_path}\n\n{description}"
  );

  let commit_oid = repo
    .commit(None, &sig, &sig, &message, &tree, &parents)
    .map_err(|e| Error::from_reason(format!("Failed to create snapshot commit: {e}")))?;

  update_hidden_ref(&repo, commit_oid, &format!("exegol: {operation} snapshot"))?;

  let commit = repo
    .find_commit(commit_oid)
    .map_err(|e| Error::from_reason(format!("Failed to reload snapshot commit: {e}")))?;

  Ok(OplogSnapshotInfo {
    sha: commit_oid.to_string(),
    parent_sha: parent_oid.map(|o| o.to_string()),
    operation,
    agent_id,
    provider,
    turn_index,
    description,
    timestamp: commit.time().seconds(),
    worktree_path: Some(repo_path),
  })
}

/// Parse the `operation`/`agent-id`/`provider`/`turn-index` trailers out of
/// a snapshot commit message; everything after the blank line that follows
/// them is the free-text description.
fn parse_snapshot_message(message: &str) -> (String, String, String, i64, String, String) {
  // Fixed layout: "<title>\n\n<trailers block>\n\n<description>".
  let mut parts = message.splitn(3, "\n\n");
  let _title = parts.next().unwrap_or("");
  let trailers = parts.next().unwrap_or("");
  let description = parts.next().unwrap_or("").trim().to_string();

  let mut operation = String::new();
  let mut agent_id = String::new();
  let mut provider = String::new();
  let mut turn_index = 0i64;
  let mut worktree_path = String::new();

  for line in trailers.lines() {
    if let Some(v) = line.strip_prefix("operation: ") {
      operation = v.to_string();
    } else if let Some(v) = line.strip_prefix("agent-id: ") {
      agent_id = v.to_string();
    } else if let Some(v) = line.strip_prefix("provider: ") {
      provider = v.to_string();
    } else if let Some(v) = line.strip_prefix("turn-index: ") {
      turn_index = v.trim().parse().unwrap_or(0);
    } else if let Some(v) = line.strip_prefix("worktree-path: ") {
      worktree_path = v.to_string();
    }
  }

  (
    operation,
    agent_id,
    provider,
    turn_index,
    description,
    worktree_path,
  )
}

/// Walk the hidden oplog chain from its tip, most recent first.
#[napi]
pub fn list_oplog_snapshots(repo_path: String, limit: u32) -> Result<Vec<OplogSnapshotInfo>, Error> {
  let repo = open_repo(&repo_path)?;

  let mut result = Vec::new();
  let mut cursor = hidden_ref_target(&repo);

  while let Some(oid) = cursor {
    if result.len() >= limit as usize {
      break;
    }
    // Tolerate a broken link: one unreadable commit (pruned/corrupt) should
    // truncate the listing at that point, not hide the entire timeline.
    let Ok(commit) = repo.find_commit(oid) else {
      break;
    };

    let (operation, agent_id, provider, turn_index, description, worktree_path) =
      parse_snapshot_message(commit.message().unwrap_or(""));
    let parent_oid = commit.parent_id(0).ok();

    result.push(OplogSnapshotInfo {
      sha: oid.to_string(),
      parent_sha: parent_oid.map(|o| o.to_string()),
      operation,
      agent_id,
      provider,
      turn_index,
      description,
      timestamp: commit.time().seconds(),
      worktree_path: if worktree_path.is_empty() {
        None
      } else {
        Some(worktree_path)
      },
    });

    cursor = parent_oid;
  }

  Ok(result)
}

/// Restore working directory + a new HEAD commit to a snapshot's tree.
/// Reuses the same "never force-push, always create a new commit" semantics
/// as `revert_to_snapshot` — the snapshot's tree is resolvable by SHA
/// regardless of hidden-ref reachability once committed to the odb.
///
/// Safety rails (GitButler model):
/// 1. A snapshot taken in a different worktree is never restored here —
///    pipeline-worktree state must not overwrite the user's main checkout.
///    If the original worktree is gone, the snapshot is view-only.
/// 2. A "PreRestore" snapshot of the CURRENT state (incl. untracked files)
///    is committed to the chain first, so restore is itself undoable.
#[napi]
pub fn restore_oplog_snapshot(repo_path: String, sha: String) -> Result<String, Error> {
  let repo = open_repo(&repo_path)?;
  let oid =
    Oid::from_str(&sha).map_err(|e| Error::from_reason(format!("Invalid SHA '{sha}': {e}")))?;
  let commit = repo
    .find_commit(oid)
    .map_err(|e| Error::from_reason(format!("Snapshot '{sha}' not found: {e}")))?;
  let (_, _, _, _, _, origin_path) = parse_snapshot_message(commit.message().unwrap_or(""));

  if !origin_path.is_empty() && origin_path != repo_path {
    if std::path::Path::new(&origin_path).exists() {
      return Err(Error::from_reason(format!(
        "Snapshot was taken in a different worktree ({origin_path}) — restore it there, not into this checkout"
      )));
    }
    return Err(Error::from_reason(format!(
      "Snapshot's original worktree ({origin_path}) no longer exists — snapshot is view-only"
    )));
  }
  drop(commit);

  // Safety snapshot of the current state so the restore itself is undoable.
  let short: String = sha.chars().take(8).collect();
  let prepared = prepare_turn_snapshot(repo_path.clone())?;
  commit_turn_snapshot(
    repo_path.clone(),
    prepared.tree_sha,
    "PreRestore".into(),
    String::new(),
    "exegol".into(),
    0,
    format!("State before restoring snapshot {short}"),
  )?;

  revert_to_snapshot(repo_path, sha, Some(true))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::Path;
  use tempfile::TempDir;

  fn init_repo() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let repo = Repository::init(tmp.path()).unwrap();
    fs::write(tmp.path().join("a.txt"), "one\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    let tree_oid = index.write_tree().unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();
    let sig = Signature::now("Test", "test@local").unwrap();
    repo
      .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
      .unwrap();
    tmp
  }

  #[test]
  fn hidden_ref_never_touches_branches() {
    let tmp = init_repo();
    let path = tmp.path().to_string_lossy().into_owned();

    let prepared = prepare_turn_snapshot(path.clone()).unwrap();
    assert!(prepared.parent_sha.is_none());

    let snap = commit_turn_snapshot(
      path.clone(),
      prepared.tree_sha,
      "AgentTurn".into(),
      "agent-1".into(),
      "claude-code".into(),
      0,
      "first turn".into(),
    )
    .unwrap();

    let repo = open_repo(&path).unwrap();
    // Never advances HEAD or creates a branch.
    let head = repo.head().unwrap();
    assert_ne!(head.peel_to_commit().unwrap().id().to_string(), snap.sha);
    assert!(repo.find_branch(&snap.sha, git2::BranchType::Local).is_err());
    assert!(hidden_ref_target(&repo).is_some());
  }

  #[test]
  fn chain_links_and_trailers_roundtrip() {
    let tmp = init_repo();
    let path = tmp.path().to_string_lossy().into_owned();

    let p1 = prepare_turn_snapshot(path.clone()).unwrap();
    let s1 = commit_turn_snapshot(
      path.clone(),
      p1.tree_sha,
      "AgentTurn".into(),
      "agent-1".into(),
      "claude-code".into(),
      0,
      "first".into(),
    )
    .unwrap();

    fs::write(Path::new(&path).join("b.txt"), "two\n").unwrap();
    let p2 = prepare_turn_snapshot(path.clone()).unwrap();
    assert_eq!(p2.parent_sha.as_deref(), Some(s1.sha.as_str()));

    let s2 = commit_turn_snapshot(
      path.clone(),
      p2.tree_sha,
      "AgentTurn".into(),
      "agent-1".into(),
      "claude-code".into(),
      1,
      "second".into(),
    )
    .unwrap();

    let entries = list_oplog_snapshots(path.clone(), 10).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].sha, s2.sha);
    assert_eq!(entries[0].turn_index, 1);
    assert_eq!(entries[0].parent_sha.as_deref(), Some(s1.sha.as_str()));
    assert_eq!(entries[1].sha, s1.sha);
    assert_eq!(entries[1].description, "first");

    // Restoring never force-pushes: it's a brand new commit on the real branch.
    let new_sha = restore_oplog_snapshot(path.clone(), s1.sha.clone()).unwrap();
    assert_ne!(new_sha, s1.sha);
    let content = fs::read_to_string(Path::new(&path).join("b.txt"));
    assert!(content.is_err(), "b.txt should be gone after restoring to the first snapshot");
  }
}
