//! Libuv-threadpool variants of the git and search calls the main process polls.
//! The sync versions froze Electron's main thread (PTY pump included) for the whole walk.

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

use crate::git::{check_has_changes, get_diff, get_worktree_diff, FileDiff};
use crate::search::{fs_grep, fs_search, GrepHit, GrepOptions, SearchLimits, SearchResult};

pub struct WorktreeHasChangesTask {
  path: String,
}

#[napi]
impl Task for WorktreeHasChangesTask {
  type Output = bool;
  type JsValue = bool;

  fn compute(&mut self) -> Result<bool> {
    check_has_changes(&self.path)
  }

  fn resolve(&mut self, _env: Env, output: bool) -> Result<bool> {
    Ok(output)
  }
}

/// Async `worktreeHasChanges`, computed off the JS thread.
#[napi]
pub fn worktree_has_changes_async(worktree_path: String) -> AsyncTask<WorktreeHasChangesTask> {
  AsyncTask::new(WorktreeHasChangesTask { path: worktree_path })
}

pub struct GetDiffTask {
  repo_path: String,
  staged: bool,
}

#[napi]
impl Task for GetDiffTask {
  type Output = Vec<FileDiff>;
  type JsValue = Vec<FileDiff>;

  fn compute(&mut self) -> Result<Vec<FileDiff>> {
    get_diff(self.repo_path.clone(), self.staged)
  }

  fn resolve(&mut self, _env: Env, output: Vec<FileDiff>) -> Result<Vec<FileDiff>> {
    Ok(output)
  }
}

/// Async `getDiff`, computed off the JS thread.
#[napi]
pub fn get_diff_async(repo_path: String, staged: bool) -> AsyncTask<GetDiffTask> {
  AsyncTask::new(GetDiffTask { repo_path, staged })
}

pub struct GetWorktreeDiffTask {
  path: String,
}

#[napi]
impl Task for GetWorktreeDiffTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<String> {
    get_worktree_diff(self.path.clone())
  }

  fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
    Ok(output)
  }
}

/// Async `getWorktreeDiff`, computed off the JS thread.
#[napi]
pub fn get_worktree_diff_async(worktree_path: String) -> AsyncTask<GetWorktreeDiffTask> {
  AsyncTask::new(GetWorktreeDiffTask { path: worktree_path })
}

pub struct FsSearchTask {
  query: String,
  root: String,
  limits: SearchLimits,
}

#[napi]
impl Task for FsSearchTask {
  type Output = Vec<SearchResult>;
  type JsValue = Vec<SearchResult>;

  fn compute(&mut self) -> Result<Vec<SearchResult>> {
    fs_search(self.query.clone(), self.root.clone(), self.limits.clone())
  }

  fn resolve(&mut self, _env: Env, output: Vec<SearchResult>) -> Result<Vec<SearchResult>> {
    Ok(output)
  }
}

/// Async `fsSearch`, computed off the JS thread.
#[napi]
pub fn fs_search_async(query: String, root: String, limits: SearchLimits) -> AsyncTask<FsSearchTask> {
  AsyncTask::new(FsSearchTask { query, root, limits })
}

pub struct FsGrepTask {
  pattern: String,
  root: String,
  opts: GrepOptions,
}

#[napi]
impl Task for FsGrepTask {
  type Output = Vec<GrepHit>;
  type JsValue = Vec<GrepHit>;

  fn compute(&mut self) -> Result<Vec<GrepHit>> {
    fs_grep(self.pattern.clone(), self.root.clone(), self.opts.clone())
  }

  fn resolve(&mut self, _env: Env, output: Vec<GrepHit>) -> Result<Vec<GrepHit>> {
    Ok(output)
  }
}

/// Async `fsGrep`, computed off the JS thread.
#[napi]
pub fn fs_grep_async(pattern: String, root: String, opts: GrepOptions) -> AsyncTask<FsGrepTask> {
  AsyncTask::new(FsGrepTask { pattern, root, opts })
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
  fn async_tasks_compute_what_the_sync_calls_return() {
    let tmp = committed_repo();
    let path = tmp.path().to_string_lossy().into_owned();
    let mut dirty = WorktreeHasChangesTask { path: path.clone() };
    assert!(!dirty.compute().unwrap());

    fs::write(tmp.path().join("a.txt"), "two\n").unwrap();
    assert!(dirty.compute().unwrap());
    assert!(GetWorktreeDiffTask { path: path.clone() }.compute().unwrap().contains("+two"));
    let staged = false;
    assert_eq!(GetDiffTask { repo_path: path.clone(), staged }.compute().unwrap().len(), 1);

    let opts = GrepOptions {
      case_insensitive: None,
      include_hidden: None,
      respect_gitignore: None,
      max_matches: None,
      max_file_size_kb: None,
      globs: None,
    };
    let hits = FsGrepTask { pattern: "two".into(), root: path.clone(), opts }.compute().unwrap();
    assert_eq!(hits.len(), 1);

    let limits =
      SearchLimits { max_results: None, max_depth: None, include_hidden: None, respect_gitignore: None };
    let names = FsSearchTask { query: "a.txt".into(), root: path, limits }.compute().unwrap();
    assert!(names.iter().any(|r| r.relative_path == "a.txt"));
  }
}
