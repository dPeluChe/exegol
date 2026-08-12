//! T150 — golden parity vectors shared with the JS mirror
//! (apps/desktop/src/main/agents/status-parser-parity.test.ts).
//! Rust is the source of truth; edit the JSON only alongside both suites.

use super::osc_notify::OscNotifyScanner;
use super::status_parser::AgentOutputStream;
use super::strip_ansi::strip_ansi;
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    strip: Vec<StripCase>,
    signals: Vec<SignalCase>,
    status: Vec<StatusCase>,
}

#[derive(Deserialize)]
struct StripCase {
    name: String,
    input: String,
    expected: String,
}

#[derive(Deserialize)]
struct ExpectedSignal {
    #[serde(rename = "agentId")]
    agent_id: String,
    event: String,
}

#[derive(Deserialize)]
struct SignalCase {
    name: String,
    chunks: Vec<String>,
    expected: Vec<ExpectedSignal>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusCase {
    name: String,
    cli_type: String,
    #[serde(default)]
    resume_pattern: Option<String>,
    chunks: Vec<String>,
    expected_status: Option<String>,
    expected_step: Option<String>,
    #[serde(default)]
    expected_token_limit: bool,
    #[serde(default)]
    expected_session_id: Option<String>,
    #[serde(default)]
    expected_resume: Option<String>,
}

fn load_vectors() -> Vectors {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/test-vectors/parser-vectors.json");
    let raw = std::fs::read_to_string(path).expect("parser-vectors.json must exist");
    serde_json::from_str(&raw).expect("parser-vectors.json must be valid")
}

#[test]
fn parity_strip_vectors() {
    for case in load_vectors().strip {
        assert_eq!(
            strip_ansi(case.input.clone()),
            case.expected,
            "strip vector failed: {}",
            case.name
        );
    }
}

#[test]
fn parity_signal_vectors() {
    for case in load_vectors().signals {
        let mut scanner = OscNotifyScanner::new();
        let mut got = Vec::new();
        for chunk in &case.chunks {
            got.extend(scanner.scan(chunk));
        }
        assert_eq!(got.len(), case.expected.len(), "signal count mismatch: {}", case.name);
        for (g, e) in got.iter().zip(case.expected.iter()) {
            assert_eq!(g.agent_id, e.agent_id, "signal agentId mismatch: {}", case.name);
            assert_eq!(g.event, e.event, "signal event mismatch: {}", case.name);
        }
    }
}

#[test]
fn parity_status_vectors() {
    for case in load_vectors().status {
        let mut stream = AgentOutputStream::new(
            case.cli_type.clone(),
            case.resume_pattern.clone().unwrap_or_default(),
        );
        let mut status: Option<String> = None;
        let mut step: Option<String> = None;
        let mut token_limit = false;
        let mut session_id: Option<String> = None;
        let mut resume: Option<String> = None;

        for chunk in &case.chunks {
            let out = stream.process_chunk(chunk.clone()).expect("process_chunk");
            if out.status.is_some() || out.current_step.is_some() {
                status = out.status;
                step = out.current_step;
            }
            token_limit |= out.token_limit_warning;
            if out.session_id.is_some() {
                session_id = out.session_id;
            }
            if out.resume_command.is_some() {
                resume = out.resume_command;
            }
        }

        assert_eq!(status, case.expected_status, "status mismatch: {}", case.name);
        assert_eq!(step, case.expected_step, "step mismatch: {}", case.name);
        assert_eq!(token_limit, case.expected_token_limit, "tokenLimit mismatch: {}", case.name);
        assert_eq!(session_id, case.expected_session_id, "sessionId mismatch: {}", case.name);
        assert_eq!(resume, case.expected_resume, "resume mismatch: {}", case.name);
    }
}
