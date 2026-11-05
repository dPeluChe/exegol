use napi_derive::napi;

/// Body bytes kept per OSC: state and kind come first in every known emitter (pi, Claude Code),
/// so a long base64 `msg` is cut without losing them.
const MAX_BODY_CHARS: usize = 256;
const STATUS_STATES: [&str; 6] = ["idle", "working", "blocked", "done", "error", "clear"];
const BLOCKED_KINDS: [&str; 3] = ["permission", "question", "auth"];

/// A program's own report of what it is doing, read from its output:
/// `progress` (OSC 9;4, state "0".."4"), `status` (OSC 7501 root record) or `query` (OSC 7501 ; ?).
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TermReport {
    pub kind: String,
    pub state: String,
    /// What a blocked program waits for: permission, question or auth.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

/// Byte-level FSM over raw PTY output: survives chunk boundaries, ends an OSC on BEL or ST.
pub struct OscStatusScanner {
    state: State,
    body: String,
    body_chars: usize,
}

impl Default for OscStatusScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl OscStatusScanner {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            body: String::new(),
            body_chars: 0,
        }
    }

    pub fn scan(&mut self, s: &str) -> Vec<TermReport> {
        let mut out = Vec::new();
        let mut rest = s;
        while !rest.is_empty() {
            if self.state == State::Ground {
                // Hot path: most output has no OSC, so jump straight to the next ESC
                let Some(i) = memchr::memchr(0x1b, rest.as_bytes()) else {
                    break;
                };
                self.state = State::Esc;
                rest = &rest[i + 1..];
                continue;
            }
            let mut chars = rest.chars();
            let Some(ch) = chars.next() else { break };
            rest = chars.as_str();
            self.step(ch, &mut out);
        }
        out
    }

    fn step(&mut self, ch: char, out: &mut Vec<TermReport>) {
        match self.state {
            State::Ground => {}
            State::Esc => match ch {
                ']' => self.start_osc(),
                '\x1b' => {}
                _ => self.state = State::Ground,
            },
            State::Osc => match ch {
                '\x07' => self.finish(out),
                '\x1b' => self.state = State::OscEsc,
                _ => {
                    if self.body_chars < MAX_BODY_CHARS {
                        self.body.push(ch);
                        self.body_chars += 1;
                    }
                }
            },
            State::OscEsc => match ch {
                '\\' => self.finish(out),
                ']' => self.start_osc(),
                '\x1b' => self.state = State::Esc,
                _ => self.state = State::Ground,
            },
        }
    }

    pub fn reset(&mut self) {
        self.state = State::Ground;
        self.body.clear();
        self.body_chars = 0;
    }

    fn start_osc(&mut self) {
        self.state = State::Osc;
        self.body.clear();
        self.body_chars = 0;
    }

    fn finish(&mut self, out: &mut Vec<TermReport>) {
        if let Some(report) = parse_body(&self.body) {
            out.push(report);
        }
        self.reset();
    }
}

fn report(kind: &str, state: &str, detail: Option<String>) -> TermReport {
    TermReport {
        kind: kind.to_string(),
        state: state.to_string(),
        detail,
    }
}

fn parse_body(body: &str) -> Option<TermReport> {
    if body == "9;4" || body.starts_with("9;4;") {
        let state = body.get(4..).unwrap_or("").split(';').next().unwrap_or("");
        let state = if state.is_empty() { "0" } else { state };
        return matches!(state, "0" | "1" | "2" | "3" | "4")
            .then(|| report("progress", state, None));
    }
    let rest = body.strip_prefix("7501;")?;
    if rest.starts_with('?') {
        return Some(report("query", "", None));
    }
    let mut state = None;
    let mut kind = None;
    for pair in rest.split(':') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            // A record with an id is one part of the work, not the program's status
            "id" if !value.is_empty() => return None,
            "state" => state = Some(value),
            "kind" => kind = Some(value),
            _ => {}
        }
    }
    let state = state.filter(|s| STATUS_STATES.contains(s))?;
    let detail = kind
        .filter(|k| state == "blocked" && BLOCKED_KINDS.contains(k))
        .map(str::to_string);
    Some(report("status", state, detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan_all(chunks: &[&str]) -> Vec<TermReport> {
        let mut scanner = OscStatusScanner::new();
        chunks.iter().flat_map(|c| scanner.scan(c)).collect()
    }

    #[test]
    fn progress_with_bel_and_st() {
        let got = scan_all(&["\x1b]9;4;3\x07a\x1b]9;4;0;\x1b\\"]);
        assert_eq!(
            got,
            vec![report("progress", "3", None), report("progress", "0", None)]
        );
    }

    #[test]
    fn progress_split_across_chunks() {
        let got = scan_all(&["x\x1b", "]9;", "4;1;4", "0\x1b", "\\"]);
        assert_eq!(got, vec![report("progress", "1", None)]);
    }

    #[test]
    fn status_root_records_only() {
        let got = scan_all(&[
            "\x1b]7501;state=working:app=claude-code\x1b\\",
            "\x1b]7501;state=done:id=build\x07",
            "\x1b]7501;state=blocked:kind=permission:msg=QXBwbHk/\x07",
        ]);
        assert_eq!(
            got,
            vec![
                report("status", "working", None),
                report("status", "blocked", Some("permission".into())),
            ]
        );
    }

    #[test]
    fn query_and_unknown_states() {
        let got = scan_all(&["\x1b]7501;?\x1b\\\x1b]7501;state=dancing\x07\x1b]9;4;9\x07"]);
        assert_eq!(got, vec![report("query", "", None)]);
    }

    #[test]
    fn other_osc_and_aborted_sequences_ignored() {
        let got = scan_all(&["\x1b]0;9;4;3\x07\x1b]9;4;3\x1b[0m\x1b]8;;http://x\x1b\\"]);
        assert!(got.is_empty());
    }
}
