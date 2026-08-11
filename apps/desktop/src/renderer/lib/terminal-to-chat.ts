/**
 * T90: Parse terminal scrollback into conversational turns.
 *
 * Strategy: detect user input echoes (lines starting with common prompts)
 * and treat everything else as agent output. This is heuristic — different
 * CLIs have different output patterns.
 */

export type ChatRole = "user" | "agent" | "system";

export interface ChatTurn {
  role: ChatRole;
  content: string;
  /** Approximate line index in the original scrollback */
  lineIndex: number;
}

// Prompt patterns that indicate user input
const USER_PROMPT_PATTERNS = [
  /^>\s/, // Aider prompt
  /^❯\s/, // Gemini prompt
  /^\$\s/, // Shell prompt
  /^Human:\s/i, // Claude format
  /^User:\s/i, // Generic
  /^you:\s/i, // Informal
  /^Question:\s/i, // Q&A format
];

// Claude Code-specific patterns: tool calls indicate agent output
const AGENT_TOOL_PATTERNS = [
  /^\s*\b(Read|Edit|Write|Bash|Agent|Glob|Grep|WebFetch|WebSearch|TodoWrite)\s*\(/i,
  /^Thinking\.\.\./i,
  /^I'll\s/i, // Common Claude phrasing
  /^Let me\s/i,
  /^Here's\s/i,
];

// System/status patterns
const SYSTEM_PATTERNS = [
  /^─{3,}/, // Separator lines
  /^={3,}/, // Separator lines
  /^Session ID:/i, // Startup banner
  /^Tips for getting started/i,
  /^Type \/help/i,
  /^Resume this session/i,
  /^To resume this session/i,
];

// Serialize output is raw terminal bytes — without stripping, the chat view
// renders SGR soup (`[38;2;…m`, `[1C`). Covers CSI (any final byte, so cursor
// moves like `1C` too), OSC, and single-char escapes; then compacts blank runs.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI parsing needs ESC/BEL
const ANSI_SEQ_RE = /\][^]*(?:|\\)|\[[0-9;:?]*[ -/]*[@-~]|[@-_]/g;

function stripAnsiForChat(text: string): string {
  return text
    .replace(ANSI_SEQ_RE, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Parse terminal text into chat turns.
 * Groups consecutive lines of the same role into single turns.
 */
export function parseTerminalToChat(scrollback: string): ChatTurn[] {
  if (!scrollback.trim()) return [];

  const lines = stripAnsiForChat(scrollback).split("\n");
  const turns: ChatTurn[] = [];
  let currentRole: ChatRole = "agent";
  let currentLines: string[] = [];
  let currentLineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Skip completely empty lines within a turn (but preserve them)
    if (!trimmed) {
      if (currentLines.length > 0) currentLines.push("");
      continue;
    }

    // Detect role from patterns
    let detectedRole: ChatRole = "agent";
    if (SYSTEM_PATTERNS.some((p) => p.test(trimmed))) {
      detectedRole = "system";
    } else if (USER_PROMPT_PATTERNS.some((p) => p.test(trimmed))) {
      detectedRole = "user";
    } else if (AGENT_TOOL_PATTERNS.some((p) => p.test(trimmed))) {
      detectedRole = "agent"; // Explicit — reinforces tool calls as agent output
    }

    // Role change → flush current turn
    if (detectedRole !== currentRole && currentLines.length > 0) {
      const content = currentLines.join("\n").trim();
      if (content) {
        turns.push({ role: currentRole, content, lineIndex: currentLineIndex });
      }
      currentLines = [];
      currentLineIndex = i;
      currentRole = detectedRole;
    }

    // First line of new turn
    if (currentLines.length === 0) {
      currentLineIndex = i;
      currentRole = detectedRole;
    }

    currentLines.push(line);
  }

  // Flush remaining
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) {
      turns.push({ role: currentRole, content, lineIndex: currentLineIndex });
    }
  }

  return turns;
}
