use super::open_repo;
use super::types::{FileDiff, DiffHunk, DiffLine};
use git2::{Delta, Diff, DiffOptions};
use napi::Error;
use napi_derive::napi;

/// Convert a git2::Delta to a human-readable status string.
fn delta_to_status(delta: Delta) -> &'static str {
  match delta {
    Delta::Added | Delta::Untracked => "added",
    Delta::Deleted => "deleted",
    Delta::Modified => "modified",
    Delta::Renamed => "renamed",
    Delta::Copied => "copied",
    Delta::Typechange => "modified",
    _ => "modified",
  }
}

/// Extract structured FileDiff list from a git2::Diff object.
fn extract_file_diffs(diff: &Diff) -> Result<Vec<FileDiff>, Error> {
  let num_deltas = diff.deltas().len();
  let mut file_diffs: Vec<FileDiff> = Vec::with_capacity(num_deltas);

  // First pass: create FileDiff entries for each delta
  for delta in diff.deltas() {
    let new_path = delta
      .new_file()
      .path()
      .and_then(|p| p.to_str())
      .unwrap_or("")
      .to_string();
    let old_path = delta
      .old_file()
      .path()
      .and_then(|p| p.to_str())
      .map(String::from);

    let path = if new_path.is_empty() {
      old_path.clone().unwrap_or_default()
    } else {
      new_path
    };

    let is_binary = delta.new_file().is_binary() || delta.old_file().is_binary();

    file_diffs.push(FileDiff {
      path,
      old_path,
      status: delta_to_status(delta.status()).to_string(),
      binary: is_binary,
      hunks: Vec::new(),
    });
  }

  // Second pass: walk hunks and lines to populate file_diffs
  let mut current_file_idx: usize = 0;
  let mut current_hunk: Option<DiffHunk> = None;

  diff
    .print(git2::DiffFormat::Patch, |delta, hunk_header, line| {
      let delta_new_path = delta
        .new_file()
        .path()
        .and_then(|p| p.to_str())
        .unwrap_or("");
      let delta_old_path = delta
        .old_file()
        .path()
        .and_then(|p| p.to_str())
        .unwrap_or("");

      // Match to file_diffs entry
      for (i, fd) in file_diffs.iter().enumerate() {
        if fd.path == delta_new_path
          || fd.old_path.as_deref() == Some(delta_old_path)
        {
          if i != current_file_idx {
            if let Some(h) = current_hunk.take() {
              if current_file_idx < file_diffs.len() {
                file_diffs[current_file_idx].hunks.push(h);
              }
            }
            current_file_idx = i;
          }
          break;
        }
      }

      match line.origin() {
        'H' => {
          if let Some(h) = current_hunk.take() {
            if current_file_idx < file_diffs.len() {
              file_diffs[current_file_idx].hunks.push(h);
            }
          }
          if let Some(hh) = hunk_header {
            current_hunk = Some(DiffHunk {
              old_start: hh.old_start(),
              old_lines: hh.old_lines(),
              new_start: hh.new_start(),
              new_lines: hh.new_lines(),
              header: std::str::from_utf8(hh.header())
                .unwrap_or("")
                .trim()
                .to_string(),
              lines: Vec::new(),
            });
          }
        }
        '+' | '-' | ' ' => {
          let content = std::str::from_utf8(line.content())
            .unwrap_or("")
            .to_string();
          let content = if content.ends_with('\n') {
            content[..content.len() - 1].to_string()
          } else {
            content
          };

          let line_type = match line.origin() {
            '+' => "addition",
            '-' => "deletion",
            _ => "context",
          };

          if let Some(ref mut hunk) = current_hunk {
            hunk.lines.push(DiffLine {
              content,
              line_type: line_type.to_string(),
              old_lineno: line.old_lineno(),
              new_lineno: line.new_lineno(),
            });
          }
        }
        _ => {}
      }

      true
    })
    .map_err(|e| Error::from_reason(format!("Failed to walk diff: {e}")))?;

  // Flush last hunk
  if let Some(h) = current_hunk.take() {
    if current_file_idx < file_diffs.len() {
      file_diffs[current_file_idx].hunks.push(h);
    }
  }

  Ok(file_diffs)
}

/// Get structured diff of changes (staged or unstaged).
/// Returns a list of FileDiff objects with hunks and lines.
#[napi]
pub fn get_diff(repo_path: String, staged: bool) -> Result<Vec<FileDiff>, Error> {
  let repo = open_repo(&repo_path)?;

  let mut diff_opts = DiffOptions::new();
  diff_opts.context_lines(3);

  let diff = if staged {
    let head_tree = repo
      .head()
      .ok()
      .and_then(|h| h.peel_to_tree().ok());
    repo
      .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))
      .map_err(|e| Error::from_reason(format!("Failed to compute staged diff: {e}")))?
  } else {
    diff_opts.include_untracked(true).recurse_untracked_dirs(true);
    let head_tree = repo
      .head()
      .ok()
      .and_then(|h| h.peel_to_tree().ok());
    repo
      .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
      .map_err(|e| Error::from_reason(format!("Failed to compute unstaged diff: {e}")))?
  };

  extract_file_diffs(&diff)
}
