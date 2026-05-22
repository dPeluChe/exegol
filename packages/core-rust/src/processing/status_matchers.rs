use super::status_parser::truncate_str;

/// Case-insensitive substring check (no allocation).
pub(super) fn contains_ci(haystack: &str, needle: &str) -> bool {
    if needle.len() > haystack.len() {
        return false;
    }
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// Case-insensitive starts-with check (no allocation).
pub(super) fn starts_with_ci(haystack: &str, needle: &str) -> bool {
    haystack.len() >= needle.len()
        && haystack.as_bytes()[..needle.len()].eq_ignore_ascii_case(needle.as_bytes())
}

/// Case-insensitive ends-with check (no allocation).
#[allow(dead_code)]
pub(super) fn ends_with_ci(haystack: &str, needle: &str) -> bool {
    haystack.len() >= needle.len()
        && haystack.as_bytes()[haystack.len() - needle.len()..].eq_ignore_ascii_case(needle.as_bytes())
}

/// Extract a Claude session ID from a startup line (T101).
/// Claude Code prints lines like:
///   "Session ID: abc123def456..."
///   "│ Session ID: abc123..."   (inside a box-drawing border)
/// Returns the session ID string if found (alphanumeric + hyphens, ≥8 chars).
pub(super) fn parse_session_id(line: &str) -> Option<String> {
    // Case-insensitive search for "session id:"
    let lower = line.to_ascii_lowercase();
    let marker = "session id:";
    let pos = lower.find(marker)?;
    let after = line[pos + marker.len()..].trim();
    // Extract contiguous alphanumeric+hyphen token
    let id: String = after
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if id.len() >= 8 {
        Some(id)
    } else {
        None
    }
}

/// Generic resume command extractor (T101).
/// Searches `line` for `pattern` (case-insensitive) and returns everything
/// from that position to the next line-break or box-drawing character.
/// The result must be longer than the pattern itself (i.e. it includes a session ID).
pub(super) fn parse_resume_command_pattern(pattern: &str, line: &str) -> Option<String> {
    if pattern.is_empty() {
        return None;
    }
    let lower = line.to_ascii_lowercase();
    let pattern_lower = pattern.to_ascii_lowercase();
    let pos = lower.find(pattern_lower.as_str())?;
    let cmd = line[pos..].trim();
    let end = cmd
        .find(['\n', '│', '|'])
        .unwrap_or(cmd.len());
    let result = cmd[..end].trim().to_string();
    // Must contain more than just the pattern (i.e. has a session ID appended)
    if result.len() > pattern.trim_end().len() {
        Some(result)
    } else {
        None
    }
}

/// Check if a line indicates a token limit warning.
pub(super) fn check_token_limit(line: &str) -> bool {
    contains_ci(line, "context window")
        || contains_ci(line, "token limit")
        || contains_ci(line, "maximum context")
        || contains_ci(line, "conversation too long")
        || contains_ci(line, "truncating context")
}

/// Parse a single cleaned line for status updates.
/// Returns (optional_status, optional_current_step).
pub(super) fn parse_line(cli_type: &str, line: &str) -> Option<(Option<String>, Option<String>)> {
    match cli_type {
        "claude-code" => parse_claude_code(line),
        "codex" => parse_codex(line),
        "aider" => parse_aider(line),
        "gemini" => parse_gemini(line),
        _ => parse_generic(line),
    }
}

fn parse_claude_code(line: &str) -> Option<(Option<String>, Option<String>)> {
    // Tool call detection
    for tool in &[
        "Read", "Edit", "Write", "Bash", "Agent", "Glob", "Grep",
        "WebFetch", "WebSearch", "TodoWrite",
    ] {
        if line.contains(tool) && line.contains('(') {
            return Some((None, Some(format!("Tool: {tool}"))));
        }
    }

    // File operations
    if starts_with_ci(line, "editing ") || starts_with_ci(line, "writing ") || starts_with_ci(line, "reading ") {
        let step = truncate_str(line, 120);
        return Some((None, Some(step.to_string())));
    }

    // Waiting for input
    if contains_ci(line, "waiting for input")
        || contains_ci(line, "do you want to")
        || contains_ci(line, "y/n")
        || contains_ci(line, "(yes/no)")
    {
        return Some((
            Some("waiting_input".to_string()),
            Some("Waiting for user input".to_string()),
        ));
    }

    // Error
    if starts_with_ci(line, "error:") || starts_with_ci(line, "internal error") || starts_with_ci(line, "fatal:") {
        let step = truncate_str(line, 120);
        return Some((Some("failed".to_string()), Some(step.to_string())));
    }

    // Thinking
    if contains_ci(line, "thinking") || contains_ci(line, "analyzing") || contains_ci(line, "processing") {
        return Some((None, Some("Thinking...".to_string())));
    }

    None
}

fn parse_codex(line: &str) -> Option<(Option<String>, Option<String>)> {
    if contains_ci(line, "calling ") || contains_ci(line, "running ") || contains_ci(line, "executing ") {
        // Extract tool name — find case-insensitive position
        for prefix in &["calling ", "running ", "executing "] {
            if let Some(pos) = line.to_ascii_lowercase().find(prefix) {
                let rest = &line[pos + prefix.len()..];
                let tool: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                if !tool.is_empty() {
                    return Some((None, Some(format!("Tool: {tool}"))));
                }
            }
        }
    }

    if contains_ci(line, "thinking") || contains_ci(line, "reasoning") {
        return Some((None, Some("Thinking...".to_string())));
    }

    if line.ends_with('?') || contains_ci(line, "confirm") || contains_ci(line, "y/n") {
        return Some((
            Some("waiting_input".to_string()),
            Some("Waiting for user input".to_string()),
        ));
    }

    if starts_with_ci(line, "error") || starts_with_ci(line, "failed") || starts_with_ci(line, "exception") {
        let step = truncate_str(line, 120);
        return Some((Some("failed".to_string()), Some(step.to_string())));
    }

    None
}

fn parse_aider(line: &str) -> Option<(Option<String>, Option<String>)> {
    if contains_ci(line, "editing ") {
        let step = truncate_str(line, 120);
        return Some((None, Some(step.to_string())));
    }

    if contains_ci(line, "applied edit to ") {
        // Find position case-insensitively
        if let Some(pos) = line.to_ascii_lowercase().find("applied edit to ") {
            let file = &line[pos + 16..];
            return Some((None, Some(format!("Applied edit: {file}"))));
        }
    }

    if contains_ci(line, "git diff") {
        return Some((None, Some("Reviewing changes...".to_string())));
    }

    if contains_ci(line, "searching") {
        return Some((None, Some("Searching codebase...".to_string())));
    }

    if line.trim() == ">" || line.trim() == "?" {
        return Some((
            Some("waiting_input".to_string()),
            Some("Waiting for user input".to_string()),
        ));
    }

    if starts_with_ci(line, "error") || starts_with_ci(line, "traceback") || starts_with_ci(line, "exception") {
        let step = truncate_str(line, 120);
        return Some((Some("failed".to_string()), Some(step.to_string())));
    }

    None
}

fn parse_gemini(line: &str) -> Option<(Option<String>, Option<String>)> {
    for prefix in &["using ", "calling ", "executing "] {
        if contains_ci(line, prefix) {
            if let Some(pos) = line.to_ascii_lowercase().find(prefix) {
                let rest = &line[pos + prefix.len()..];
                let tool: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                if !tool.is_empty() {
                    return Some((None, Some(format!("Tool: {tool}"))));
                }
            }
        }
    }

    if contains_ci(line, "thinking") || contains_ci(line, "generating") {
        return Some((None, Some("Thinking...".to_string())));
    }

    if line.ends_with('?') || contains_ci(line, "confirm") || contains_ci(line, "y/n") {
        return Some((
            Some("waiting_input".to_string()),
            Some("Waiting for user input".to_string()),
        ));
    }

    if starts_with_ci(line, "error") || starts_with_ci(line, "failed") {
        let step = truncate_str(line, 120);
        return Some((Some("failed".to_string()), Some(step.to_string())));
    }

    None
}

fn parse_generic(line: &str) -> Option<(Option<String>, Option<String>)> {
    if starts_with_ci(line, "error") || starts_with_ci(line, "fail") || starts_with_ci(line, "fatal") || contains_ci(line, "exception") || contains_ci(line, "traceback") {
        let step = truncate_str(line, 120);
        return Some((Some("failed".to_string()), Some(step.to_string())));
    }

    if line.ends_with('?') || contains_ci(line, "(y/n)") || contains_ci(line, "confirm") || contains_ci(line, "press enter") {
        return Some((
            Some("waiting_input".to_string()),
            Some("Waiting for user input".to_string()),
        ));
    }

    if contains_ci(line, "test") && (contains_ci(line, "passed") || contains_ci(line, "failed") || contains_ci(line, "running")) {
        let step = truncate_str(line, 120);
        return Some((None, Some(step.to_string())));
    }

    if contains_ci(line, "reading ") || contains_ci(line, "writing ") || contains_ci(line, "editing ") || contains_ci(line, "creating ") || contains_ci(line, "deleting ") {
        let step = truncate_str(line, 120);
        return Some((None, Some(step.to_string())));
    }

    None
}
