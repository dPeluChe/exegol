//! Libuv-threadpool napi exports for the git and search calls the main process polls.
//! Sync versions froze Electron's main thread (PTY pump included) for the whole walk.

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

use crate::git::{get_diff, get_worktree_diff, worktree_has_changes, FileDiff};
use crate::search::{fs_grep, fs_search, GrepHit, GrepOptions, SearchLimits, SearchResult};

/// `fn name(args) -> Out as Task = compute`: a `Task` holding the args, run by `compute` on the
/// pool, and the `#[napi]` export returning it.
macro_rules! async_task {
  ($(#[$doc:meta])* fn $name:ident($($arg:ident: $ty:ty),*) -> $out:ty as $task:ident = $compute:path) => {
    pub struct $task {
      $($arg: $ty),*
    }

    #[napi]
    impl Task for $task {
      type Output = $out;
      type JsValue = $out;

      fn compute(&mut self) -> Result<$out> {
        $compute($(std::mem::take(&mut self.$arg)),*)
      }

      fn resolve(&mut self, _env: Env, output: $out) -> Result<$out> {
        Ok(output)
      }
    }

    $(#[$doc])*
    #[napi]
    pub fn $name($($arg: $ty),*) -> AsyncTask<$task> {
      AsyncTask::new($task { $($arg),* })
    }
  };
}

async_task! {
  /// Whether a worktree has uncommitted changes, computed off the JS thread.
  fn worktree_has_changes_async(worktree_path: String) -> bool as WorktreeHasChangesTask = worktree_has_changes
}

async_task! {
  /// Structured diff (staged or unstaged), computed off the JS thread.
  fn get_diff_async(repo_path: String, staged: bool) -> Vec<FileDiff> as GetDiffTask = get_diff
}

async_task! {
  /// Unified diff of a worktree, computed off the JS thread.
  fn get_worktree_diff_async(worktree_path: String) -> String as GetWorktreeDiffTask = get_worktree_diff
}

async_task! {
  /// Fuzzy file find under `root`, computed off the JS thread.
  fn fs_search_async(query: String, root: String, limits: SearchLimits) -> Vec<SearchResult> as FsSearchTask = fs_search
}

async_task! {
  /// Regex content search under `root`, computed off the JS thread.
  fn fs_grep_async(pattern: String, root: String, opts: GrepOptions) -> Vec<GrepHit> as FsGrepTask = fs_grep
}

#[cfg(test)]
mod tests {
  use super::*;
  use git2::Repository;
  use std::fs;
  use std::path::Path;
  use tempfile::TempDir;

  fn committed_repo() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let repo = Repository::init(tmp.path()).unwrap();
    fs::write(tmp.path().join("a.txt"), "one\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("Test", "test@local").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
    tmp
  }

  #[test]
  fn async_tasks_compute_dirty_state_diffs_and_searches() {
    let tmp = committed_repo();
    let path = tmp.path().to_string_lossy().into_owned();
    let dirty = || WorktreeHasChangesTask { worktree_path: path.clone() }.compute().unwrap();
    assert!(!dirty());

    fs::write(tmp.path().join("a.txt"), "two\n").unwrap();
    assert!(dirty());
    assert!(GetWorktreeDiffTask { worktree_path: path.clone() }.compute().unwrap().contains("+two"));
    let staged = false;
    assert_eq!(GetDiffTask { repo_path: path.clone(), staged }.compute().unwrap().len(), 1);

    let opts = GrepOptions::default();
    let hits = FsGrepTask { pattern: "two".into(), root: path.clone(), opts }.compute().unwrap();
    assert_eq!(hits.len(), 1);

    let limits = SearchLimits::default();
    let names = FsSearchTask { query: "a.txt".into(), root: path, limits }.compute().unwrap();
    assert!(names.iter().any(|r| r.relative_path == "a.txt"));
  }
}
