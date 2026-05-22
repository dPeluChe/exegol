use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::path::Path;

use ignore::WalkBuilder;
use napi::{Error, Result};
use napi_derive::napi;

use super::types::{SearchLimits, SearchResult};

const DEFAULT_MAX_RESULTS: u32 = 100;
const HARD_MAX_RESULTS: u32 = 500;
const DEFAULT_MAX_DEPTH: u32 = 16;
const HARD_MAX_DEPTH: u32 = 32;

/// Fuzzy-find files and directories under `root`.
///
/// `root` MUST be a directory the caller is authorized to search; this
/// function does no path validation. Results are gitignore-aware (default)
/// and bounded by `max_results`.
///
/// Scoring: basename substring (+200) outranks full-path substring (+100);
/// word-boundary hits add +50; subsequence-only matches score by query
/// length. Empty query returns the first `max_results` entries in walk order.
#[napi]
pub fn fs_search(query: String, root: String, limits: SearchLimits) -> Result<Vec<SearchResult>> {
  let root_path = Path::new(&root);
  if !root_path.is_dir() {
    return Err(Error::from_reason(format!("not a directory: {root}")));
  }

  let max_results = limits
    .max_results
    .unwrap_or(DEFAULT_MAX_RESULTS)
    .clamp(1, HARD_MAX_RESULTS) as usize;
  let max_depth = limits
    .max_depth
    .unwrap_or(DEFAULT_MAX_DEPTH)
    .clamp(1, HARD_MAX_DEPTH) as usize;
  let include_hidden = limits.include_hidden.unwrap_or(false);
  let respect_gitignore = limits.respect_gitignore.unwrap_or(true);

  let walker = WalkBuilder::new(root_path)
    .hidden(!include_hidden)
    .git_ignore(respect_gitignore)
    .git_global(respect_gitignore)
    .git_exclude(respect_gitignore)
    .ignore(respect_gitignore)
    .parents(respect_gitignore)
    .follow_links(false)
    .max_depth(Some(max_depth))
    .build();

  let query_lower = query.trim().to_lowercase();

  if query_lower.is_empty() {
    let mut out: Vec<SearchResult> = Vec::with_capacity(max_results.min(64));
    for dent in walker.flatten() {
      let path = dent.path();
      if path == root_path {
        continue;
      }
      let rel = match path.strip_prefix(root_path) {
        Ok(r) => to_forward_slash(r),
        Err(_) => continue,
      };
      let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
      out.push(SearchResult {
        path: path.to_string_lossy().into_owned(),
        relative_path: rel,
        score: 0,
        is_dir,
      });
      if out.len() >= max_results {
        break;
      }
    }
    return Ok(out);
  }

  let mut heap: BinaryHeap<HeapEntry> = BinaryHeap::with_capacity(max_results + 1);

  for dent in walker.flatten() {
    let path = dent.path();
    if path == root_path {
      continue;
    }
    let rel = match path.strip_prefix(root_path) {
      Ok(r) => to_forward_slash(r),
      Err(_) => continue,
    };
    let basename = path
      .file_name()
      .map(|s| s.to_string_lossy().into_owned())
      .unwrap_or_default();

    let Some(score) = score_entry(&query_lower, &basename.to_lowercase(), &rel.to_lowercase())
    else {
      continue;
    };

    let entry = HeapEntry {
      score,
      rel,
      abs: path.to_string_lossy().into_owned(),
      is_dir: dent.file_type().map(|t| t.is_dir()).unwrap_or(false),
    };

    if heap.len() < max_results {
      heap.push(entry);
    } else if let Some(worst) = heap.peek() {
      if entry < *worst {
        heap.pop();
        heap.push(entry);
      }
    }
  }

  let mut out: Vec<SearchResult> = heap
    .into_iter()
    .map(|e| SearchResult {
      path: e.abs,
      relative_path: e.rel,
      score: e.score,
      is_dir: e.is_dir,
    })
    .collect();

  out.sort_by(|a, b| {
    b.score
      .cmp(&a.score)
      .then_with(|| a.relative_path.cmp(&b.relative_path))
  });

  Ok(out)
}

struct HeapEntry {
  score: i32,
  rel: String,
  abs: String,
  is_dir: bool,
}

impl PartialEq for HeapEntry {
  fn eq(&self, other: &Self) -> bool {
    self.score == other.score && self.rel == other.rel
  }
}

impl Eq for HeapEntry {}

impl PartialOrd for HeapEntry {
  fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
    Some(self.cmp(other))
  }
}

impl Ord for HeapEntry {
  fn cmp(&self, other: &Self) -> Ordering {
    // Max-heap retains the "worst" entry at the top for eviction:
    // worst = lower score, or same score with lexically larger relative path.
    other
      .score
      .cmp(&self.score)
      .then_with(|| self.rel.cmp(&other.rel))
  }
}

fn score_entry(query: &str, basename_lower: &str, rel_lower: &str) -> Option<i32> {
  let mut score = 0;
  if basename_lower.contains(query) {
    score += 200;
  } else if rel_lower.contains(query) {
    score += 100;
  } else if is_subsequence(rel_lower, query) {
    score += query.len() as i32;
  } else {
    return None;
  }
  if word_boundary_match(basename_lower, query) {
    score += 50;
  }
  Some(score)
}

fn is_subsequence(haystack: &str, needle: &str) -> bool {
  let mut hc = haystack.chars();
  for nc in needle.chars() {
    if !hc.any(|c| c == nc) {
      return false;
    }
  }
  true
}

fn word_boundary_match(haystack: &str, needle: &str) -> bool {
  if needle.is_empty() {
    return false;
  }
  for (pos, _) in haystack.match_indices(needle) {
    if pos == 0 {
      return true;
    }
    let prev = haystack[..pos].chars().next_back();
    if matches!(prev, Some('/' | '-' | '_' | '.' | ' ')) {
      return true;
    }
  }
  false
}

fn to_forward_slash(p: &Path) -> String {
  let s = p.to_string_lossy().into_owned();
  if std::path::MAIN_SEPARATOR == '/' {
    s
  } else {
    s.replace(std::path::MAIN_SEPARATOR, "/")
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use tempfile::TempDir;

  fn write(dir: &Path, rel: &str, contents: &str) {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
      fs::create_dir_all(parent).unwrap();
    }
    fs::write(p, contents).unwrap();
  }

  fn limits() -> SearchLimits {
    SearchLimits {
      max_results: None,
      max_depth: None,
      include_hidden: None,
      respect_gitignore: None,
    }
  }

  #[test]
  fn finds_file_by_basename() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "src/main.rs", "");
    write(tmp.path(), "src/lib.rs", "");
    write(tmp.path(), "README.md", "");

    let results = fs_search(
      "main.rs".into(),
      tmp.path().to_string_lossy().into_owned(),
      limits(),
    )
    .unwrap();

    assert!(results.iter().any(|r| r.relative_path == "src/main.rs"));
  }

  #[test]
  fn respects_gitignore() {
    let tmp = TempDir::new().unwrap();
    fs::create_dir(tmp.path().join(".git")).unwrap();
    write(tmp.path(), ".gitignore", "ignored/\n*.log\n");
    write(tmp.path(), "ignored/secret.txt", "");
    write(tmp.path(), "build.log", "");
    write(tmp.path(), "kept.txt", "");

    let results = fs_search(
      "txt".into(),
      tmp.path().to_string_lossy().into_owned(),
      limits(),
    )
    .unwrap();

    assert!(results.iter().any(|r| r.relative_path == "kept.txt"));
    assert!(!results.iter().any(|r| r.relative_path.contains("secret")));
  }

  #[test]
  fn hidden_files_excluded_by_default() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), ".hidden", "");
    write(tmp.path(), "visible.txt", "");

    let results = fs_search(
      "hidden".into(),
      tmp.path().to_string_lossy().into_owned(),
      limits(),
    )
    .unwrap();

    assert!(results.iter().all(|r| !r.relative_path.starts_with('.')));
  }

  #[test]
  fn hidden_files_included_when_requested() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), ".env", "X=1");
    write(tmp.path(), "visible.txt", "");

    let mut l = limits();
    l.include_hidden = Some(true);
    l.respect_gitignore = Some(false);
    let results = fs_search(".env".into(), tmp.path().to_string_lossy().into_owned(), l).unwrap();

    assert!(results.iter().any(|r| r.relative_path == ".env"));
  }

  #[test]
  fn max_results_bound_is_honored() {
    let tmp = TempDir::new().unwrap();
    for i in 0..20 {
      write(tmp.path(), &format!("file_{i}.txt"), "");
    }

    let mut l = limits();
    l.max_results = Some(5);
    let results = fs_search("file".into(), tmp.path().to_string_lossy().into_owned(), l).unwrap();

    assert_eq!(results.len(), 5);
  }

  #[test]
  fn max_depth_bound_is_honored() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a/b/c/d/deep.txt", "");
    write(tmp.path(), "top.txt", "");

    let mut l = limits();
    l.max_depth = Some(2);
    let results = fs_search("txt".into(), tmp.path().to_string_lossy().into_owned(), l).unwrap();

    assert!(results.iter().any(|r| r.relative_path == "top.txt"));
    assert!(!results.iter().any(|r| r.relative_path.contains("deep.txt")));
  }

  #[test]
  fn empty_query_returns_first_n_entries() {
    let tmp = TempDir::new().unwrap();
    for i in 0..10 {
      write(tmp.path(), &format!("file_{i}.txt"), "");
    }

    let mut l = limits();
    l.max_results = Some(3);
    let results = fs_search("".into(), tmp.path().to_string_lossy().into_owned(), l).unwrap();

    assert_eq!(results.len(), 3);
    assert!(results.iter().all(|r| r.score == 0));
  }

  #[test]
  fn non_existent_root_returns_err() {
    let res = fs_search(
      "anything".into(),
      "/this/path/definitely/does/not/exist/anywhere".into(),
      limits(),
    );
    assert!(res.is_err());
  }

  #[test]
  fn basename_match_outranks_path_only_match() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "config/other.txt", "");
    write(tmp.path(), "src/config.rs", "");

    let results = fs_search(
      "config".into(),
      tmp.path().to_string_lossy().into_owned(),
      limits(),
    )
    .unwrap();

    let config_rs = results
      .iter()
      .find(|r| r.relative_path == "src/config.rs")
      .expect("config.rs present");
    let other_txt = results
      .iter()
      .find(|r| r.relative_path == "config/other.txt")
      .expect("other.txt present");
    assert!(config_rs.score > other_txt.score);
  }
}
