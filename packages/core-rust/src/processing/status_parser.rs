use super::strip_ansi::strip_ansi_bytes;
use napi::Error;
use napi_derive::napi;

/// Truncate a string to at most `max_bytes` bytes, ensuring the cut falls on a char boundary.
fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Result of processing a chunk of PTY output.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ProcessedOutput {
    /// Cleaned lines (ANSI stripped, CR removed) — for scrollback storage.
    pub clean_text: String,
    /// Status update if a meaningful pattern was detected.
    pub status: Option<String>,
    /// Current step/tool being executed.
    pub current_step: Option<String>,
    /// Whether a token limit warning was detected.
    pub token_limit_warning: bool,
    /// Claude session ID parsed from startup output (T101).
    pub session_id: Option<String>,
}

/// Persistent state for an agent's output stream.
/// Holds the incomplete line buffer between chunks.
#[napi]
pub struct AgentOutputStream {
    cli_type: String,
    buffer: String,
}

#[napi]
impl AgentOutputStream {
    /// Create a new output stream for an agent.
    #[napi(constructor)]
    pub fn new(cli_type: String) -> Self {
        Self {
            cli_type,
            buffer: String::with_capacity(1024),
        }
    }

    /// Process a chunk of raw PTY output.
    /// Returns cleaned text + optional status update.
    #[napi]
    pub fn process_chunk(&mut self, raw_data: String) -> Result<ProcessedOutput, Error> {
        // Strip ANSI from the raw data
        let clean = strip_ansi_bytes(raw_data.as_bytes());

        // Accumulate into line buffer
        self.buffer.push_str(&clean);

        // Cap buffer at 10KB (find nearest char boundary to avoid panics)
        if self.buffer.len() > 10240 {
            let mut start = self.buffer.len() - 10240;
            // Advance to next char boundary (avoid slicing mid-UTF8)
            while start < self.buffer.len() && !self.buffer.is_char_boundary(start) {
                start += 1;
            }
            self.buffer = self.buffer[start..].to_string();
        }

        // Split into complete lines
        let mut status: Option<String> = None;
        let mut current_step: Option<String> = None;
        let mut token_limit_warning = false;
        let mut session_id: Option<String> = None;

        // Process complete lines (keep last incomplete line in buffer)
        let last_newline = self.buffer.rfind('\n');
        if let Some(pos) = last_newline {
            let complete = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 1..].to_string();

            for line in complete.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.len() < 3 {
                    continue;
                }

                // Check token limit warning (all CLI types)
                if check_token_limit(trimmed) {
                    token_limit_warning = true;
                }

                // Parse session ID (T101) — only for claude-code
                if session_id.is_none() && self.cli_type == "claude-code" {
                    if let Some(id) = parse_session_id(trimmed) {
                        session_id = Some(id);
                    }
                }

                // Parse status based on CLI type
                if let Some((s, step)) = parse_line(&self.cli_type, trimmed) {
                    status = s;
                    current_step = step;
                }
            }
        }

        Ok(ProcessedOutput {
            clean_text: clean,
            status,
            current_step,
            token_limit_warning,
            session_id,
        })
    }

    /// Reset the buffer (e.g., on agent restart).
    #[napi]
    pub fn reset(&mut self) {
        self.buffer.clear();
    }
}

/// Case-insensitive substring check (no allocation).
fn contains_ci(haystack: &str, needle: &str) -> bool {
    if needle.len() > haystack.len() {
        return false;
    }
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// Case-insensitive starts-with check (no allocation).
fn starts_with_ci(haystack: &str, needle: &str) -> bool {
    haystack.len() >= needle.len()
        && haystack.as_bytes()[..needle.len()].eq_ignore_ascii_case(needle.as_bytes())
}

/// Case-insensitive ends-with check (no allocation).
#[allow(dead_code)]
fn ends_with_ci(haystack: &str, needle: &str) -> bool {
    haystack.len() >= needle.len()
        && haystack.as_bytes()[haystack.len() - needle.len()..].eq_ignore_ascii_case(needle.as_bytes())
}

/// Extract a Claude session ID from a startup line (T101).
/// Claude Code prints lines like:
///   "Session ID: abc123def456..."
///   "│ Session ID: abc123..."   (inside a box-drawing border)
/// Returns the session ID string if found (alphanumeric + hyphens, ≥8 chars).
fn parse_session_id(line: &str) -> Option<String> {
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

/// Check if a line indicates a token limit warning.
fn check_token_limit(line: &str) -> bool {
    contains_ci(line, "context window")
        || contains_ci(line, "token limit")
        || contains_ci(line, "maximum context")
        || contains_ci(line, "conversation too long")
        || contains_ci(line, "truncating context")
}

/// Parse a single cleaned line for status updates.
/// Returns (optional_status, optional_current_step).
fn parse_line(cli_type: &str, line: &str) -> Option<(Option<String>, Option<String>)> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_tool_detection() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream.process_chunk("Read(src/main.ts)\n".into()).unwrap();
        assert_eq!(result.current_step.as_deref(), Some("Tool: Read"));
    }

    #[test]
    fn test_token_limit() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream.process_chunk("Warning: context window is almost full\n".into()).unwrap();
        assert!(result.token_limit_warning);
    }

    #[test]
    fn test_error_detection() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream.process_chunk("error: something went wrong\n".into()).unwrap();
        assert_eq!(result.status.as_deref(), Some("failed"));
    }

    #[test]
    fn test_partial_lines() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        // Send partial line
        let r1 = stream.process_chunk("Read(sr".into()).unwrap();
        assert!(r1.current_step.is_none()); // Not complete yet
        // Complete the line
        let r2 = stream.process_chunk("c/main.ts)\n".into()).unwrap();
        assert_eq!(r2.current_step.as_deref(), Some("Tool: Read"));
    }

    #[test]
    fn test_ansi_in_output() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream.process_chunk("\x1B[32mRead(file.ts)\x1B[0m\n".into()).unwrap();
        assert_eq!(result.current_step.as_deref(), Some("Tool: Read"));
    }

    #[test]
    fn test_session_id_plain() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream.process_chunk("Session ID: abc123def456\n".into()).unwrap();
        assert_eq!(result.session_id.as_deref(), Some("abc123def456"));
    }

    #[test]
    fn test_session_id_boxed() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        // Box-drawing style like Claude Code UI startup
        let result = stream.process_chunk("│ Session ID: a1b2c3d4e5f6 │\n".into()).unwrap();
        assert_eq!(result.session_id.as_deref(), Some("a1b2c3d4e5f6"));
    }

    #[test]
    fn test_session_id_uuid() {
        let mut stream = AgentOutputStream::new("claude-code".into());
        let result = stream
            .process_chunk("Session ID: 550e8400-e29b-41d4-a716-446655440000\n".into())
            .unwrap();
        assert_eq!(
            result.session_id.as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
    }

    #[test]
    fn test_session_id_not_captured_for_other_clis() {
        let mut stream = AgentOutputStream::new("codex".into());
        let result = stream.process_chunk("Session ID: abc123def456\n".into()).unwrap();
        assert!(result.session_id.is_none());
    }
}
