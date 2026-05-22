use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use napi::{Error, Result};
use napi_derive::napi;

use super::types::{GrepHit, GrepOptions};

const DEFAULT_MAX_MATCHES: u32 = 500;
const HARD_MAX_MATCHES: u32 = 5000;
const DEFAULT_MAX_FILE_KB: u32 = 1024;
const HARD_MAX_FILE_KB: u32 = 10240;
const LINE_CAP: usize = 240;

/// Regex-search file contents under `root`. Gitignore-aware by default,
/// honors `globs` include filters, skips files larger than
/// `max_file_size_kb`, stops early once `max_matches` is reached.
///
/// `root` MUST be a directory the caller is authorized to search; this
/// function does no path validation. Returns Err on invalid regex or
/// missing root.
#[napi]
pub fn fs_grep(pattern: String, root: String, opts: GrepOptions) -> Result<Vec<GrepHit>> {
  if pattern.is_empty() {
    return Err(Error::from_reason("pattern must not be empty"));
  }
  let root_path = Path::new(&root);
  if !root_path.is_dir() {
    return Err(Error::from_reason(format!("not a directory: {root}")));
  }

  let case_insensitive = opts.case_insensitive.unwrap_or(false);
  let include_hidden = opts.include_hidden.unwrap_or(false);
  let respect_gitignore = opts.respect_gitignore.unwrap_or(true);
  let max_matches = opts
    .max_matches
    .unwrap_or(DEFAULT_MAX_MATCHES)
    .clamp(1, HARD_MAX_MATCHES) as usize;
  let max_file_size_kb = opts
    .max_file_size_kb
    .unwrap_or(DEFAULT_MAX_FILE_KB)
    .clamp(1, HARD_MAX_FILE_KB) as u64;
  let max_file_bytes = max_file_size_kb.saturating_mul(1024);

  let matcher = RegexMatcherBuilder::new()
    .case_insensitive(case_insensitive)
    .line_terminator(Some(b'\n'))
    .build(&pattern)
    .map_err(|e| Error::from_reason(format!("invalid regex: {e}")))?;

  let globs = build_globset(opts.globs.as_deref().unwrap_or(&[]))?;

  let walker = WalkBuilder::new(root_path)
    .hidden(!include_hidden)
    .git_ignore(respect_gitignore)
    .git_global(respect_gitignore)
    .git_exclude(respect_gitignore)
    .ignore(respect_gitignore)
    .parents(respect_gitignore)
    .follow_links(false)
    .build_parallel();

  let hits: Arc<Mutex<Vec<GrepHit>>> = Arc::new(Mutex::new(Vec::with_capacity(max_matches.min(64))));
  let stop = Arc::new(AtomicBool::new(false));
  let root_owned = root_path.to_path_buf();

  walker.run(|| {
    let matcher = matcher.clone();
    let globs = globs.clone();
    let hits = hits.clone();
    let stop = stop.clone();
    let root_owned = root_owned.clone();

    Box::new(move |dent_res| {
      if stop.load(Ordering::Relaxed) {
        return WalkState::Quit;
      }
      let dent = match dent_res {
        Ok(d) => d,
        Err(_) => return WalkState::Continue,
      };
      if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
        return WalkState::Continue;
      }
      let path = dent.path();
      let rel = match path.strip_prefix(&root_owned) {
        Ok(r) => to_forward_slash(r),
        Err(_) => return WalkState::Continue,
      };
      if let Some(set) = globs.as_ref() {
        if !set.is_match(&rel) {
          return WalkState::Continue;
        }
      }
      if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > max_file_bytes {
          return WalkState::Continue;
        }
      }

      let abs = path.to_string_lossy().into_owned();
      let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

      let matcher_for_sink = matcher.clone();
      let _ = searcher.search_path(
        &matcher,
        path,
        UTF8(|line_num, text| {
          let trimmed = text.trim_end_matches('\n');
          let (column_start, column_end) = match matcher_for_sink.find(trimmed.as_bytes()) {
            Ok(Some(m)) => (m.start() as u32, m.end() as u32),
            _ => (0, 0),
          };
          let line = truncate_line(trimmed);
          let line_number = u32::try_from(line_num).unwrap_or(u32::MAX);
          let mut guard = match hits.lock() {
            Ok(g) => g,
            Err(_) => return Ok(false),
          };
          if guard.len() >= max_matches {
            stop.store(true, Ordering::Relaxed);
            return Ok(false);
          }
          guard.push(GrepHit {
            path: abs.clone(),
            relative_path: rel.clone(),
            line_number,
            line,
            column_start,
            column_end,
          });
          Ok(true)
        }),
      );

      WalkState::Continue
    })
  });

  let mut out = Arc::try_unwrap(hits)
    .ok()
    .and_then(|m| m.into_inner().ok())
    .unwrap_or_default();
  out.sort_by(|a, b| {
    a.relative_path
      .cmp(&b.relative_path)
      .then(a.line_number.cmp(&b.line_number))
  });
  if out.len() > max_matches {
    out.truncate(max_matches);
  }
  Ok(out)
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>> {
  if patterns.is_empty() {
    return Ok(None);
  }
  let mut b = GlobSetBuilder::new();
  for p in patterns {
    let g = Glob::new(p).map_err(|e| Error::from_reason(format!("invalid glob {p:?}: {e}")))?;
    b.add(g);
  }
  let set = b
    .build()
    .map_err(|e| Error::from_reason(format!("globset build failed: {e}")))?;
  Ok(Some(set))
}

fn truncate_line(line: &str) -> String {
  if line.len() <= LINE_CAP {
    return line.to_string();
  }
  let mut end = LINE_CAP;
  while end > 0 && !line.is_char_boundary(end) {
    end -= 1;
  }
  format!("{}...", &line[..end])
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

  fn opts() -> GrepOptions {
    GrepOptions {
      case_insensitive: None,
      include_hidden: None,
      respect_gitignore: None,
      max_matches: None,
      max_file_size_kb: None,
      globs: None,
    }
  }

  #[test]
  fn finds_matches_across_files() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a.txt", "hello world\nfoo\n");
    write(tmp.path(), "b.txt", "another hello\n");

    let hits = fs_grep(
      "hello".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    )
    .unwrap();

    assert_eq!(hits.len(), 2);
    assert!(hits.iter().any(|h| h.relative_path == "a.txt"));
    assert!(hits.iter().any(|h| h.relative_path == "b.txt"));
  }

  #[test]
  fn case_insensitive_flag() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a.txt", "Hello\n");

    let mut o = opts();
    o.case_insensitive = Some(true);
    let hits = fs_grep("hello".into(), tmp.path().to_string_lossy().into_owned(), o).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].line_number, 1);
  }

  #[test]
  fn respects_gitignore() {
    let tmp = TempDir::new().unwrap();
    fs::create_dir(tmp.path().join(".git")).unwrap();
    write(tmp.path(), ".gitignore", "ignored/\n");
    write(tmp.path(), "ignored/skip.txt", "target\n");
    write(tmp.path(), "kept.txt", "target\n");

    let hits = fs_grep(
      "target".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    )
    .unwrap();

    assert!(hits.iter().any(|h| h.relative_path == "kept.txt"));
    assert!(!hits.iter().any(|h| h.relative_path.contains("skip")));
  }

  #[test]
  fn max_matches_caps_results() {
    let tmp = TempDir::new().unwrap();
    let body: String = (0..50).map(|i| format!("hit_{i}\n")).collect();
    write(tmp.path(), "big.txt", &body);

    let mut o = opts();
    o.max_matches = Some(10);
    let hits = fs_grep("hit_".into(), tmp.path().to_string_lossy().into_owned(), o).unwrap();
    assert_eq!(hits.len(), 10);
  }

  #[test]
  fn max_file_size_skips_large_files() {
    let tmp = TempDir::new().unwrap();
    let big = "needle\n".repeat(20_000); // ~140 KB
    write(tmp.path(), "big.txt", &big);
    write(tmp.path(), "small.txt", "needle\n");

    let mut o = opts();
    o.max_file_size_kb = Some(50);
    let hits = fs_grep("needle".into(), tmp.path().to_string_lossy().into_owned(), o).unwrap();
    assert!(hits.iter().all(|h| h.relative_path == "small.txt"));
  }

  #[test]
  fn globs_filter_by_extension() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a.ts", "needle\n");
    write(tmp.path(), "b.js", "needle\n");
    write(tmp.path(), "c.md", "needle\n");

    let mut o = opts();
    o.globs = Some(vec!["**/*.ts".into(), "**/*.tsx".into()]);
    let hits = fs_grep("needle".into(), tmp.path().to_string_lossy().into_owned(), o).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].relative_path, "a.ts");
  }

  #[test]
  fn invalid_regex_returns_err() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a.txt", "anything\n");

    let res = fs_grep(
      "(unbalanced".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    );
    assert!(res.is_err());
  }

  #[test]
  fn empty_pattern_returns_err() {
    let tmp = TempDir::new().unwrap();
    let res = fs_grep("".into(), tmp.path().to_string_lossy().into_owned(), opts());
    assert!(res.is_err());
  }

  #[test]
  fn binary_files_skipped_silently() {
    let tmp = TempDir::new().unwrap();
    // NUL byte triggers grep_searcher's binary detection
    write(tmp.path(), "bin.dat", "needle\x00needle\n");
    write(tmp.path(), "text.txt", "needle\n");

    let hits = fs_grep(
      "needle".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    )
    .unwrap();
    assert!(hits.iter().all(|h| h.relative_path == "text.txt"));
  }

  #[test]
  fn long_match_lines_are_truncated() {
    let tmp = TempDir::new().unwrap();
    let long: String = "x".repeat(500) + "needle" + &"y".repeat(500);
    write(tmp.path(), "big.txt", &format!("{long}\n"));

    let hits = fs_grep(
      "needle".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    )
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].line.len() <= LINE_CAP + 3); // +3 for "..."
    assert!(hits[0].line.ends_with("..."));
  }

  #[test]
  fn columns_point_at_match() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "a.txt", "abc needle def\n");

    let hits = fs_grep(
      "needle".into(),
      tmp.path().to_string_lossy().into_owned(),
      opts(),
    )
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].column_start, 4);
    assert_eq!(hits[0].column_end, 10);
  }
}
