use napi_derive::napi;

/// OSC 777 notify payload prefix emitted by CLI hooks: `ESC ] 777 ; notify ; Exegol ; <agentId> ; <event> BEL`.
/// Distinct from the pre-existing `777;exegol-shell-ready` marker (shell-wrappers.ts).
const OSC777_NOTIFY_PREFIX: &[u8] = b"\x1b]777;notify;Exegol;";
const MAX_PAYLOAD_LEN: usize = 256;

#[napi(object)]
#[derive(Debug, Clone)]
pub struct AgentSignal {
    pub agent_id: String,
    pub event: String,
}

/// Byte-level FSM that survives PTY chunk boundaries, mirroring the JS
/// `scanForMarker` approach used for the shell-ready marker.
pub struct OscNotifyScanner {
    match_pos: usize,
    capturing: bool,
    payload: String,
}

impl Default for OscNotifyScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl OscNotifyScanner {
    pub fn new() -> Self {
        Self {
            match_pos: 0,
            capturing: false,
            payload: String::new(),
        }
    }

    /// Scan a chunk of raw (pre-strip) PTY output and return any completed signals.
    pub fn scan(&mut self, s: &str) -> Vec<AgentSignal> {
        let mut out = Vec::new();
        for ch in s.chars() {
            if self.capturing {
                if ch as u32 == 0x07 {
                    if let Some(signal) = split_payload(&self.payload) {
                        out.push(signal);
                    }
                    self.payload.clear();
                    self.capturing = false;
                    self.match_pos = 0;
                    continue;
                }
                self.payload.push(ch);
                if self.payload.len() > MAX_PAYLOAD_LEN {
                    // Malformed/unterminated sequence — bail out rather than growing unbounded.
                    self.payload.clear();
                    self.capturing = false;
                    self.match_pos = 0;
                }
                continue;
            }

            let expected = OSC777_NOTIFY_PREFIX[self.match_pos] as char;
            if ch == expected {
                self.match_pos += 1;
                if self.match_pos == OSC777_NOTIFY_PREFIX.len() {
                    self.capturing = true;
                    self.match_pos = 0;
                }
            } else if ch == OSC777_NOTIFY_PREFIX[0] as char {
                self.match_pos = 1;
            } else {
                self.match_pos = 0;
            }
        }
        out
    }

    pub fn reset(&mut self) {
        self.match_pos = 0;
        self.capturing = false;
        self.payload.clear();
    }
}

fn split_payload(payload: &str) -> Option<AgentSignal> {
    let mut parts = payload.splitn(2, ';');
    let agent_id = parts.next()?.to_string();
    let event = parts.next()?.to_string();
    if agent_id.is_empty() || event.is_empty() {
        return None;
    }
    Some(AgentSignal { agent_id, event })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_signal_one_chunk() {
        let mut scanner = OscNotifyScanner::new();
        let signals = scanner.scan("\x1b]777;notify;Exegol;agent-1;attention\x07trailing text");
        assert_eq!(signals.len(), 1);
        assert_eq!(signals[0].agent_id, "agent-1");
        assert_eq!(signals[0].event, "attention");
    }

    #[test]
    fn test_signal_split_across_chunks() {
        let mut scanner = OscNotifyScanner::new();
        assert!(scanner.scan("\x1b]777;notify;Exeg").is_empty());
        let signals = scanner.scan("ol;agent-2;finished\x07");
        assert_eq!(signals.len(), 1);
        assert_eq!(signals[0].agent_id, "agent-2");
        assert_eq!(signals[0].event, "finished");
    }

    #[test]
    fn test_multiple_signals_one_chunk() {
        let mut scanner = OscNotifyScanner::new();
        let signals = scanner.scan(
            "\x1b]777;notify;Exegol;a;started\x07mid\x1b]777;notify;Exegol;a;working\x07",
        );
        assert_eq!(signals.len(), 2);
        assert_eq!(signals[0].event, "started");
        assert_eq!(signals[1].event, "working");
    }

    #[test]
    fn test_unrelated_osc_ignored() {
        let mut scanner = OscNotifyScanner::new();
        let signals = scanner.scan("\x1b]777;exegol-shell-ready\x07\x1b]0;title\x07");
        assert!(signals.is_empty());
    }

    #[test]
    fn test_malformed_payload_no_event() {
        let mut scanner = OscNotifyScanner::new();
        let signals = scanner.scan("\x1b]777;notify;Exegol;agent-only\x07");
        assert!(signals.is_empty());
    }
}
