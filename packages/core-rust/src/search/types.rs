use napi_derive::napi;

/// A filename/path hit from `fs_search`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchResult {
  /// Absolute path on disk.
  pub path: String,
  /// Path relative to the search `root` (forward-slash form).
  pub relative_path: String,
  /// Fuzzy match score (higher = better).
  pub score: i32,
  /// True if the entry is a directory.
  pub is_dir: bool,
}

/// Limits applied to `fs_search` walks.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchLimits {
  /// Max results to return. Default 100, hard cap 500.
  pub max_results: Option<u32>,
  /// Max recursion depth. Default 16, hard cap 32.
  pub max_depth: Option<u32>,
  /// Include dotfiles. Default false.
  pub include_hidden: Option<bool>,
  /// Honor `.gitignore` / `.ignore` / `.git/info/exclude`. Default true.
  pub respect_gitignore: Option<bool>,
}

/// A single line match from `fs_grep`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct GrepHit {
  /// Absolute path on disk.
  pub path: String,
  /// Path relative to the search `root` (forward-slash form).
  pub relative_path: String,
  /// 1-indexed line number where the match was found.
  pub line_number: u32,
  /// The matching line content (trailing newline stripped, truncated to ~240 chars).
  pub line: String,
  /// 0-indexed BYTE offset of the first match in the line (NOT a character column).
  /// Renderers using character-column APIs (Monaco, xterm) must convert.
  pub byte_start: u32,
  /// 0-indexed BYTE offset (exclusive) of the end of the first match in the line.
  pub byte_end: u32,
}

/// Options for `fs_grep`.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct GrepOptions {
  /// Case-insensitive regex. Default false.
  pub case_insensitive: Option<bool>,
  /// Include dotfiles. Default false.
  pub include_hidden: Option<bool>,
  /// Honor `.gitignore` / `.ignore` / `.git/info/exclude`. Default true.
  pub respect_gitignore: Option<bool>,
  /// Max matches to return. Default 500, hard cap 5000.
  pub max_matches: Option<u32>,
  /// Skip files larger than this (KB). Default 1024, hard cap 10240.
  pub max_file_size_kb: Option<u32>,
  /// Optional include globs (e.g. `["**/*.ts", "**/*.tsx"]`).
  pub globs: Option<Vec<String>>,
}
