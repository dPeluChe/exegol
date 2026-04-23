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
  /^>\s/,                      // Aider prompt
  /^❯\s/,                     // Gemini prompt
  /^\$\s/,                     // Shell prompt
  /^Human:\s/i,                // Claude format
  /^User:\s/i,                 // Generic
  /^you:\s/i,                  // Informal
  /^Question:\s/i,             // Q&A format
];

// System/status patterns
const SYSTEM_PATTERNS = [
  /^─{3,}/,                    // Separator lines
  /^={3,}/,                    // Separator lines
  /^Session ID:/i,             // Startup banner
  /^Tips for getting started/i,
  /^Type \/help/i,
  /^Resume this session/i,
  /^To resume this session/i,
];

/**
 * Parse terminal text into chat turns.
 * Groups consecutive lines of the same role into single turns.
 */
export function parseTerminalToChat(scrollback: string): ChatTurn[] {
  if (!scrollback.trim()) return [];

  const lines = scrollback.split("\n");
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
