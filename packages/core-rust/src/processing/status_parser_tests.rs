use super::status_parser::AgentOutputStream;

#[test]
fn test_claude_tool_detection() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    let result = stream.process_chunk("Read(src/main.ts)\n".into()).unwrap();
    assert_eq!(result.current_step.as_deref(), Some("Tool: Read"));
}

#[test]
fn test_token_limit() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    let result = stream.process_chunk("Warning: context window is almost full\n".into()).unwrap();
    assert!(result.token_limit_warning);
}

#[test]
fn test_error_detection() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    let result = stream.process_chunk("error: something went wrong\n".into()).unwrap();
    assert_eq!(result.status.as_deref(), Some("failed"));
}

#[test]
fn test_partial_lines() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    // Send partial line
    let r1 = stream.process_chunk("Read(sr".into()).unwrap();
    assert!(r1.current_step.is_none()); // Not complete yet
    // Complete the line
    let r2 = stream.process_chunk("c/main.ts)\n".into()).unwrap();
    assert_eq!(r2.current_step.as_deref(), Some("Tool: Read"));
}

#[test]
fn test_ansi_in_output() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    let result = stream.process_chunk("\x1B[32mRead(file.ts)\x1B[0m\n".into()).unwrap();
    assert_eq!(result.current_step.as_deref(), Some("Tool: Read"));
}

#[test]
fn test_session_id_plain() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    let result = stream.process_chunk("Session ID: abc123def456\n".into()).unwrap();
    assert_eq!(result.session_id.as_deref(), Some("abc123def456"));
}

#[test]
fn test_session_id_boxed() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
    // Box-drawing style like Claude Code UI startup
    let result = stream.process_chunk("│ Session ID: a1b2c3d4e5f6 │\n".into()).unwrap();
    assert_eq!(result.session_id.as_deref(), Some("a1b2c3d4e5f6"));
}

#[test]
fn test_session_id_uuid() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "".into());
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
    let mut stream = AgentOutputStream::new("codex".into(), "".into());
    let result = stream.process_chunk("Session ID: abc123def456\n".into()).unwrap();
    assert!(result.session_id.is_none());
}

// ─── Resume command parsing ─────────────────────────────────────────

#[test]
fn test_resume_claude() {
    let mut stream = AgentOutputStream::new("claude-code".into(), "claude --resume ".into());
    let result = stream
        .process_chunk("Resume this session with:\nclaude --resume b916619f-7df7-47eb-96c5-1ddd53b11050\n".into())
        .unwrap();
    assert_eq!(
        result.resume_command.as_deref(),
        Some("claude --resume b916619f-7df7-47eb-96c5-1ddd53b11050")
    );
}

#[test]
fn test_resume_gemini() {
    let mut stream = AgentOutputStream::new("gemini".into(), "gemini --resume ".into());
    let result = stream
        .process_chunk("To resume this session: gemini --resume 32400961-7efd-4ab4-8401-0d38e8be269b\n".into())
        .unwrap();
    assert_eq!(
        result.resume_command.as_deref(),
        Some("gemini --resume 32400961-7efd-4ab4-8401-0d38e8be269b")
    );
}

#[test]
fn test_resume_codex() {
    let mut stream = AgentOutputStream::new("codex".into(), "codex resume ".into());
    let result = stream
        .process_chunk("To continue this session, run codex resume 019d9315-be7b-7680-91c0-490ce93e636c\n".into())
        .unwrap();
    assert_eq!(
        result.resume_command.as_deref(),
        Some("codex resume 019d9315-be7b-7680-91c0-490ce93e636c")
    );
}

#[test]
fn test_resume_droid() {
    let mut stream = AgentOutputStream::new("factory-droid".into(), "droid --resume ".into());
    let result = stream
        .process_chunk("To resume this session, run: droid --resume 1c26e630-bc6e-4b5b-8c59-76ec2ea5c81d\n".into())
        .unwrap();
    assert_eq!(
        result.resume_command.as_deref(),
        Some("droid --resume 1c26e630-bc6e-4b5b-8c59-76ec2ea5c81d")
    );
}

#[test]
fn test_resume_opencode() {
    let mut stream = AgentOutputStream::new("opencode".into(), "opencode -s ".into());
    let result = stream
        .process_chunk("Continue  opencode -s ses_26ceba925ffeES3avgJv1KYLWX\n".into())
        .unwrap();
    assert_eq!(
        result.resume_command.as_deref(),
        Some("opencode -s ses_26ceba925ffeES3avgJv1KYLWX")
    );
}

#[test]
fn test_resume_not_captured_when_pattern_empty() {
    // No pattern configured — resume command should not be captured
    let mut stream = AgentOutputStream::new("codex".into(), "".into());
    let result = stream
        .process_chunk("To resume this session: gemini --resume 32400961-abc\n".into())
        .unwrap();
    assert!(result.resume_command.is_none());
}
