use super::osc_notify::{AgentSignal, OscNotifyScanner};
use super::status_matchers::{check_token_limit, parse_line, parse_resume_command_pattern, parse_session_id};
use super::strip_ansi::strip_ansi_bytes;
use napi::Error;
use napi_derive::napi;

/// Truncate a string to at most `max_bytes` bytes, ensuring the cut falls on a char boundary.
pub(super) fn truncate_str(s: &str, max_bytes: usize) -> &str {
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
    /// Claude session ID parsed from startup output (T101, kept for backwards compat).
    pub session_id: Option<String>,
    /// Full resume command extracted from agent shutdown output (T101).
    /// e.g. "claude --resume <id>", "gemini --resume <id>", "opencode -s <id>",
    ///      "codex resume <id>", "droid --resume <id>"
    pub resume_command: Option<String>,
    /// Deterministic hook/OSC-777 signals detected in this chunk (T123).
    pub signals: Vec<AgentSignal>,
}

/// Persistent state for an agent's output stream.
/// Holds the incomplete line buffer between chunks.
#[napi]
pub struct AgentOutputStream {
    cli_type: String,
    /// Prefix substring from provider config used to detect the resume command
    /// in shutdown output. Matched case-insensitively. Empty = no detection.
    resume_command_pattern: String,
    buffer: String,
    osc_scanner: OscNotifyScanner,
}

#[napi]
impl AgentOutputStream {
    /// Create a new output stream for an agent.
    /// `resume_command_pattern`: substring prefix from provider config (e.g. "claude --resume ").
    /// Pass empty string when the provider has no resume support.
    #[napi(constructor)]
    pub fn new(cli_type: String, resume_command_pattern: String) -> Self {
        Self {
            cli_type,
            resume_command_pattern,
            buffer: String::with_capacity(1024),
            osc_scanner: OscNotifyScanner::new(),
        }
    }

    /// Process a chunk of raw PTY output.
    /// Returns cleaned text + optional status update.
    #[napi]
    pub fn process_chunk(&mut self, raw_data: String) -> Result<ProcessedOutput, Error> {
        // OSC-777 notify signals must be scanned on the raw (pre-strip) stream —
        // strip_ansi_bytes discards OSC payloads entirely.
        let signals = self.osc_scanner.scan(&raw_data);

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
        let mut resume_command: Option<String> = None;

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

                // Parse session ID from startup (claude-code only, kept for backwards compat)
                if session_id.is_none() && self.cli_type == "claude-code" {
                    if let Some(id) = parse_session_id(trimmed) {
                        session_id = Some(id);
                    }
                }

                // Parse resume command from shutdown output (T101, all CLIs)
                // Uses the provider-configured pattern — no CLI-specific code here.
                if resume_command.is_none() && !self.resume_command_pattern.is_empty() {
                    if let Some(cmd) = parse_resume_command_pattern(&self.resume_command_pattern, trimmed) {
                        resume_command = Some(cmd);
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
            resume_command,
            signals,
        })
    }

    /// Reset the buffer (e.g., on agent restart).
    #[napi]
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.osc_scanner.reset();
    }
}
