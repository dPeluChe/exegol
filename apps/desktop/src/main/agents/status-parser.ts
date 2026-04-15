import type { AgentCliType, AgentStatus } from "@exegol/shared";
import { detectTokenLimitWarning } from "./handoff";

type StatusUpdate = {
  status?: AgentStatus;
  currentStep?: string;
  tokenLimitWarning?: boolean;
  sessionId?: string;
};

/**
 * Parses agent CLI stdout to extract status information.
 * Each CLI tool has different output patterns that indicate what the agent is doing.
 */
export class AgentStatusParser {
  private static readonly MAX_BUFFER = 10240;
  private cliType: AgentCliType;
  private buffer: string = "";

  constructor(_agentId: string, cliType: AgentCliType) {
    this.cliType = cliType;
  }

  /**
   * Parse a chunk of terminal output data.
   * Returns a status update if a meaningful pattern was detected, or null.
   */
  parse(data: string): StatusUpdate | null {
    // Accumulate partial lines
    this.buffer += data;

    // Prevent unbounded buffer growth
    if (this.buffer.length > AgentStatusParser.MAX_BUFFER) {
      this.buffer = this.buffer.slice(-AgentStatusParser.MAX_BUFFER);
    }

    // Process complete lines
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    let lastUpdate: StatusUpdate | null = null;

    for (const line of lines) {
      const cleaned = stripAnsi(line).trim();
      if (!cleaned) continue;

      const update = this.parseLine(cleaned);
      if (update) {
        lastUpdate = update;
      }

      // Check for token limit warnings across all CLI types
      if (detectTokenLimitWarning(cleaned)) {
        lastUpdate = { ...lastUpdate, tokenLimitWarning: true };
      }

      // Parse session ID for claude-code (T101)
      if (this.cliType === "claude-code" && !lastUpdate?.sessionId) {
        const sessionId = parseSessionId(cleaned);
        if (sessionId) {
          lastUpdate = { ...lastUpdate, sessionId };
        }
      }
    }

    return lastUpdate;
  }

  private parseLine(line: string): StatusUpdate | null {
    switch (this.cliType) {
      case "claude-code":
        return this.parseClaudeCode(line);
      case "codex":
        return this.parseCodex(line);
      case "aider":
        return this.parseAider(line);
      case "gemini":
        return this.parseGemini(line);
      default:
        return this.parseGeneric(line);
    }
  }

  /**
   * Claude Code patterns:
   * - Tool calls: "Read(file)", "Edit(file)", "Write(file)", "Bash(cmd)", "Agent(task)"
   * - Waiting: "waiting for input", prompt indicators
   * - Errors: "Error:", "error:"
   */
  private parseClaudeCode(line: string): StatusUpdate | null {
    // Tool call detection
    const toolMatch = line.match(
      /\b(Read|Edit|Write|Bash|Agent|Glob|Grep|WebFetch|WebSearch|TodoWrite)\s*\(/i,
    );
    if (toolMatch) {
      return { currentStep: `Tool: ${toolMatch[1]}` };
    }

    // File operations
    const fileEditMatch = line.match(/(?:Editing|Writing|Reading)\s+(.+)/i);
    if (fileEditMatch) {
      return { currentStep: fileEditMatch[0] };
    }

    // Waiting for input
    if (/waiting for input|do you want to|y\/n|\(yes\/no\)/i.test(line)) {
      return { status: "waiting_input", currentStep: "Waiting for user input" };
    }

    // Error detection
    if (/^error:|internal error|fatal:/i.test(line)) {
      return { status: "failed", currentStep: line.slice(0, 120) };
    }

    // Thinking / processing
    if (/thinking|analyzing|processing/i.test(line)) {
      return { currentStep: "Thinking..." };
    }

    return null;
  }

  /**
   * OpenAI Codex patterns:
   * - Tool calls and function invocations
   * - Thinking indicators
   */
  private parseCodex(line: string): StatusUpdate | null {
    // Tool call patterns
    const toolMatch = line.match(/(?:calling|running|executing)\s+(\w+)/i);
    if (toolMatch) {
      return { currentStep: `Tool: ${toolMatch[1]}` };
    }

    // File operations
    const fileMatch = line.match(/(?:reading|writing|editing|creating)\s+(.+)/i);
    if (fileMatch) {
      return { currentStep: fileMatch[0] };
    }

    // Thinking
    if (/thinking|reasoning/i.test(line)) {
      return { currentStep: "Thinking..." };
    }

    // Waiting for input
    if (/\?\s*$|confirm|y\/n/i.test(line)) {
      return { status: "waiting_input", currentStep: "Waiting for user input" };
    }

    // Errors
    if (/^error|failed|exception/i.test(line)) {
      return { status: "failed", currentStep: line.slice(0, 120) };
    }

    return null;
  }

  /**
   * Aider patterns:
   * - "Editing file..."
   * - "Applied edit to..."
   * - "Git diff" operations
   */
  private parseAider(line: string): StatusUpdate | null {
    if (/editing\s+/i.test(line)) {
      return { currentStep: line.slice(0, 120) };
    }

    if (/applied edit to\s+(.+)/i.test(line)) {
      const match = line.match(/applied edit to\s+(.+)/i);
      return { currentStep: `Applied edit: ${match?.[1] ?? ""}` };
    }

    if (/git diff/i.test(line)) {
      return { currentStep: "Reviewing changes..." };
    }

    if (/searching/i.test(line)) {
      return { currentStep: "Searching codebase..." };
    }

    // Waiting for input (aider prompt)
    if (/^>\s*$|^\s*\?\s*$/i.test(line)) {
      return { status: "waiting_input", currentStep: "Waiting for user input" };
    }

    if (/^error|traceback|exception/i.test(line)) {
      return { status: "failed", currentStep: line.slice(0, 120) };
    }

    return null;
  }

  /**
   * Google Gemini CLI patterns.
   */
  private parseGemini(line: string): StatusUpdate | null {
    const toolMatch = line.match(/(?:using|calling|executing)\s+(\w+)/i);
    if (toolMatch) {
      return { currentStep: `Tool: ${toolMatch[1]}` };
    }

    if (/thinking|generating/i.test(line)) {
      return { currentStep: "Thinking..." };
    }

    if (/\?\s*$|confirm|y\/n/i.test(line)) {
      return { status: "waiting_input", currentStep: "Waiting for user input" };
    }

    if (/^error|failed/i.test(line)) {
      return { status: "failed", currentStep: line.slice(0, 120) };
    }

    return null;
  }

  /**
   * Generic fallback patterns for unknown CLI types.
   */
  private parseGeneric(line: string): StatusUpdate | null {
    // Error patterns
    if (/^error|^FAIL|^fatal|exception|traceback/i.test(line)) {
      return { status: "failed", currentStep: line.slice(0, 120) };
    }

    // Waiting for input patterns
    if (/\?\s*$|\(y\/n\)|confirm|press enter/i.test(line)) {
      return { status: "waiting_input", currentStep: "Waiting for user input" };
    }

    // Test runner detection
    if (/tests?\s+(?:passed|failed|running)/i.test(line)) {
      return { currentStep: line.slice(0, 120) };
    }

    // File operation patterns
    if (/(?:reading|writing|editing|creating|deleting)\s+/i.test(line)) {
      return { currentStep: line.slice(0, 120) };
    }

    return null;
  }
}

/**
 * Parse a Claude session ID from a startup output line (T101).
 * Handles formats: "Session ID: abc123" and "│ Session ID: abc123 │"
 */
export function parseSessionId(line: string): string | null {
  const match = line.match(/session\s+id:\s*([a-zA-Z0-9_-]{8,})/i);
  return match?.[1] ?? null;
}

/**
 * Strip ANSI escape codes from terminal output.
 */
export function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence stripping
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
