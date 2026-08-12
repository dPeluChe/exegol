import type { AgentCliType, AgentStatus } from "@exegol/shared";
import { detectTokenLimitWarning } from "./handoff";

type StatusUpdate = {
  status?: AgentStatus;
  currentStep?: string;
  tokenLimitWarning?: boolean;
  sessionId?: string;
  resumeCommand?: string;
  /** Deterministic hook/OSC-777 signals detected in this chunk (T123). */
  signals?: { agentId: string; event: string }[];
};

/**
 * OSC 777 notify prefix emitted by CLI hooks: `ESC ] 777 ; notify ; Exegol ; <agentId> ; <event> BEL`.
 * Distinct from the pre-existing `777;exegol-shell-ready` marker (shell-wrappers.ts).
 * JS mirror of the Rust `OscNotifyScanner` (core-rust/src/processing/osc_notify.rs) — used
 * only when the native module is unavailable (JS fallback path).
 * Parity is enforced by packages/core-rust/test-vectors/parser-vectors.json (T150).
 */
const OSC777_NOTIFY_PREFIX = "\x1b]777;notify;Exegol;";
const MAX_OSC_PAYLOAD_LEN = 256;

export class OscNotifyScanner {
  private matchPos = 0;
  private capturing = false;
  private payload = "";

  /** Scan a chunk of raw (pre-strip) PTY output and return any completed signals. */
  scan(data: string): { agentId: string; event: string }[] {
    const out: { agentId: string; event: string }[] = [];
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (this.capturing) {
        if (ch === "\x07") {
          const signal = this.splitPayload();
          if (signal) out.push(signal);
          this.payload = "";
          this.capturing = false;
          this.matchPos = 0;
          continue;
        }
        this.payload += ch;
        if (this.payload.length > MAX_OSC_PAYLOAD_LEN) {
          this.payload = "";
          this.capturing = false;
          this.matchPos = 0;
        }
        continue;
      }

      const expected = OSC777_NOTIFY_PREFIX[this.matchPos];
      if (ch === expected) {
        this.matchPos++;
        if (this.matchPos === OSC777_NOTIFY_PREFIX.length) {
          this.capturing = true;
          this.matchPos = 0;
        }
      } else if (ch === OSC777_NOTIFY_PREFIX[0]) {
        this.matchPos = 1;
      } else {
        this.matchPos = 0;
      }
    }
    return out;
  }

  private splitPayload(): { agentId: string; event: string } | null {
    const idx = this.payload.indexOf(";");
    if (idx === -1) return null;
    const agentId = this.payload.slice(0, idx);
    const event = this.payload.slice(idx + 1);
    if (!agentId || !event) return null;
    return { agentId, event };
  }

  reset(): void {
    this.matchPos = 0;
    this.capturing = false;
    this.payload = "";
  }
}

type LineUpdate = { status?: AgentStatus; currentStep?: string } | null;

const MAX_BUFFER = 10240;

/**
 * Parses agent CLI stdout to extract status information.
 * JS mirror of the Rust `AgentOutputStream` + `status_matchers.rs` (T150 parity):
 * strips ANSI per chunk, buffers clean text, skips lines shorter than 3 chars,
 * and matches with the exact same contains/starts-with semantics as Rust.
 */
export class AgentStatusParser {
  private cliType: AgentCliType;
  private resumePattern: string;
  private buffer: string = "";
  private oscScanner = new OscNotifyScanner();

  constructor(_agentId: string, cliType: AgentCliType, resumePattern?: string) {
    this.cliType = cliType;
    this.resumePattern = resumePattern ?? "";
  }

  /**
   * Parse a chunk of terminal output data.
   * Returns a status update if a meaningful pattern was detected, or null.
   */
  parse(data: string): StatusUpdate | null {
    // OSC-777 notify signals must be scanned on the raw (pre-strip) stream.
    const signals = this.oscScanner.scan(data);

    this.buffer += stripAnsi(data);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER);
    }

    let lastUpdate: StatusUpdate | null = null;

    // Process complete lines; keep the last incomplete line in the buffer.
    const lastNewline = this.buffer.lastIndexOf("\n");
    if (lastNewline !== -1) {
      const complete = this.buffer.slice(0, lastNewline);
      this.buffer = this.buffer.slice(lastNewline + 1);

      for (const line of complete.split("\n")) {
        const cleaned = line.trim();
        if (!cleaned || cleaned.length < 3) continue;

        // Check for token limit warnings across all CLI types
        if (detectTokenLimitWarning(cleaned)) {
          lastUpdate = { ...(lastUpdate ?? {}), tokenLimitWarning: true };
        }

        // Parse session ID for claude-code (T101, startup)
        if (this.cliType === "claude-code" && !lastUpdate?.sessionId) {
          const sessionId = parseSessionId(cleaned);
          if (sessionId) lastUpdate = { ...(lastUpdate ?? {}), sessionId };
        }

        // Parse resume command from shutdown output (T101, all CLIs)
        if (!lastUpdate?.resumeCommand && this.resumePattern) {
          const resumeCommand = parseResumeCommandFromPattern(this.resumePattern, cleaned);
          if (resumeCommand) lastUpdate = { ...(lastUpdate ?? {}), resumeCommand };
        }

        const update = parseLine(this.cliType, cleaned);
        if (update) {
          // Rust assigns both fields on every match — a later match with no
          // status clears an earlier one, so overwrite (even with undefined).
          lastUpdate = {
            ...(lastUpdate ?? {}),
            status: update.status,
            currentStep: update.currentStep,
          };
        }
      }
    }

    if (signals.length > 0) {
      lastUpdate = { ...(lastUpdate ?? {}), signals };
    }

    return lastUpdate;
  }
}

// ─── Line matchers (mirror of core-rust/src/processing/status_matchers.rs) ──

const WAITING: LineUpdate = { status: "waiting_input", currentStep: "Waiting for user input" };

function failed(line: string): LineUpdate {
  return { status: "failed", currentStep: line.slice(0, 120) };
}

function parseLine(cliType: AgentCliType, line: string): LineUpdate {
  switch (cliType) {
    case "claude-code":
      return parseClaudeCode(line);
    case "codex":
      return parseCodex(line);
    case "aider":
      return parseAider(line);
    case "gemini":
      return parseGemini(line);
    default:
      return parseGeneric(line);
  }
}

const CLAUDE_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Agent",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
];

function takeWord(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[\p{L}\p{N}_]/u.test(ch)) out += ch;
    else break;
  }
  return out;
}

function parseClaudeCode(line: string): LineUpdate {
  for (const tool of CLAUDE_TOOLS) {
    if (line.includes(tool) && line.includes("(")) {
      return { currentStep: `Tool: ${tool}` };
    }
  }

  const lower = line.toLowerCase();
  if (
    lower.startsWith("editing ") ||
    lower.startsWith("writing ") ||
    lower.startsWith("reading ")
  ) {
    return { currentStep: line.slice(0, 120) };
  }

  if (
    lower.includes("waiting for input") ||
    lower.includes("do you want to") ||
    lower.includes("y/n") ||
    lower.includes("(yes/no)")
  ) {
    return WAITING;
  }

  if (
    lower.startsWith("error:") ||
    lower.startsWith("internal error") ||
    lower.startsWith("fatal:")
  ) {
    return failed(line);
  }

  if (lower.includes("thinking") || lower.includes("analyzing") || lower.includes("processing")) {
    return { currentStep: "Thinking..." };
  }

  return null;
}

function parseCodex(line: string): LineUpdate {
  const lower = line.toLowerCase();
  if (lower.includes("calling ") || lower.includes("running ") || lower.includes("executing ")) {
    for (const prefix of ["calling ", "running ", "executing "]) {
      const pos = lower.indexOf(prefix);
      if (pos !== -1) {
        const tool = takeWord(line.slice(pos + prefix.length));
        if (tool) return { currentStep: `Tool: ${tool}` };
      }
    }
  }

  if (lower.includes("thinking") || lower.includes("reasoning")) {
    return { currentStep: "Thinking..." };
  }

  if (line.endsWith("?") || lower.includes("confirm") || lower.includes("y/n")) {
    return WAITING;
  }

  if (lower.startsWith("error") || lower.startsWith("failed") || lower.startsWith("exception")) {
    return failed(line);
  }

  return null;
}

function parseAider(line: string): LineUpdate {
  const lower = line.toLowerCase();
  if (lower.includes("editing ")) {
    return { currentStep: line.slice(0, 120) };
  }

  const appliedPos = lower.indexOf("applied edit to ");
  if (appliedPos !== -1) {
    return { currentStep: `Applied edit: ${line.slice(appliedPos + 16)}` };
  }

  if (lower.includes("git diff")) {
    return { currentStep: "Reviewing changes..." };
  }

  if (lower.includes("searching")) {
    return { currentStep: "Searching codebase..." };
  }

  const trimmed = line.trim();
  if (trimmed === ">" || trimmed === "?") {
    return WAITING;
  }

  if (lower.startsWith("error") || lower.startsWith("traceback") || lower.startsWith("exception")) {
    return failed(line);
  }

  return null;
}

function parseGemini(line: string): LineUpdate {
  const lower = line.toLowerCase();
  for (const prefix of ["using ", "calling ", "executing "]) {
    const pos = lower.indexOf(prefix);
    if (pos !== -1) {
      const tool = takeWord(line.slice(pos + prefix.length));
      if (tool) return { currentStep: `Tool: ${tool}` };
    }
  }

  if (lower.includes("thinking") || lower.includes("generating")) {
    return { currentStep: "Thinking..." };
  }

  if (line.endsWith("?") || lower.includes("confirm") || lower.includes("y/n")) {
    return WAITING;
  }

  if (lower.startsWith("error") || lower.startsWith("failed")) {
    return failed(line);
  }

  return null;
}

function parseGeneric(line: string): LineUpdate {
  const lower = line.toLowerCase();
  if (
    lower.startsWith("error") ||
    lower.startsWith("fail") ||
    lower.startsWith("fatal") ||
    lower.includes("exception") ||
    lower.includes("traceback")
  ) {
    return failed(line);
  }

  if (
    line.endsWith("?") ||
    lower.includes("(y/n)") ||
    lower.includes("confirm") ||
    lower.includes("press enter")
  ) {
    return WAITING;
  }

  if (
    lower.includes("test") &&
    (lower.includes("passed") || lower.includes("failed") || lower.includes("running"))
  ) {
    return { currentStep: line.slice(0, 120) };
  }

  if (
    lower.includes("reading ") ||
    lower.includes("writing ") ||
    lower.includes("editing ") ||
    lower.includes("creating ") ||
    lower.includes("deleting ")
  ) {
    return { currentStep: line.slice(0, 120) };
  }

  return null;
}

/**
 * Parse a Claude session ID from a startup output line (T101).
 * Handles formats: "Session ID: abc123" and "│ Session ID: abc123 │"
 */
export function parseSessionId(line: string): string | null {
  const marker = "session id:";
  const pos = line.toLowerCase().indexOf(marker);
  if (pos === -1) return null;
  const after = line.slice(pos + marker.length).trim();
  let id = "";
  for (const ch of after) {
    if (/[\p{L}\p{N}]/u.test(ch) || ch === "-" || ch === "_") id += ch;
    else break;
  }
  return id.length >= 8 ? id : null;
}

/**
 * Extract the full resume command from an agent's shutdown output (T101).
 * Generic pattern-based matcher — mirrors the Rust `parse_resume_command_pattern` function.
 * @param pattern - provider's `resumeCommandPattern` capability (e.g. "claude --resume ")
 * @param line - cleaned output line to search
 */
export function parseResumeCommandFromPattern(pattern: string, line: string): string | null {
  if (!pattern) return null;
  const idx = line.toLowerCase().indexOf(pattern.toLowerCase());
  if (idx === -1) return null;
  const fromMatch = line.slice(idx);
  // Stop at newline or box-drawing characters
  const end = fromMatch.search(/[\n│|]/);
  const result = (end === -1 ? fromMatch : fromMatch.slice(0, end)).trim();
  // Must be longer than just the pattern itself (i.e. includes a session ID)
  return result.length > pattern.trimEnd().length ? result : null;
}

/**
 * Strip ANSI escape codes from terminal output.
 * Char-level port of the Rust `strip_ansi_bytes` (core-rust/src/processing/strip_ansi.rs):
 * CSI, full OSC (incl. BEL/ST payloads), simple escapes, and carriage returns.
 */
export function stripAnsi(str: string): string {
  if (!str.includes("\x1b") && !str.includes("\r")) return str;

  let out = "";
  let i = 0;
  const len = str.length;

  while (i < len) {
    const c = str.charCodeAt(i);

    if (c === 0x1b) {
      i++;
      if (i >= len) break;
      const next = str.charCodeAt(i);

      if (next === 0x5b) {
        // CSI: ESC [ — skip parameter/intermediate bytes then the final byte
        i++;
        while (i < len && str.charCodeAt(i) >= 0x20 && str.charCodeAt(i) <= 0x3f) i++;
        while (i < len && str.charCodeAt(i) >= 0x20 && str.charCodeAt(i) <= 0x2f) i++;
        if (i < len && str.charCodeAt(i) >= 0x40 && str.charCodeAt(i) <= 0x7e) i++;
      } else if (next === 0x5d) {
        // OSC: ESC ] — read until BEL or ST (ESC \)
        i++;
        while (i < len) {
          const b = str.charCodeAt(i);
          if (b === 0x07) {
            i++;
            break;
          }
          if (b === 0x1b && i + 1 < len && str.charCodeAt(i + 1) === 0x5c) {
            i += 2;
            break;
          }
          i++;
        }
      } else if (next >= 0x40 && next <= 0x5f) {
        // Simple escape: ESC + single byte
        i++;
      }
      // Unknown escape — skip just the ESC
    } else if (c === 0x0d) {
      i++;
    } else {
      out += str[i];
      i++;
    }
  }

  return out;
}

/**
 * Strip OSC sequences (ESC ] ... BEL/ST). Kept for callers that clean stored
 * scrollback tails which may predate the full-OSC stripAnsi above.
 */
export function stripOscSequences(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional OSC sequence stripping
  return str.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?/g, "");
}
