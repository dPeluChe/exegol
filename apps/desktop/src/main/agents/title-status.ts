// Agent status detection from terminal title escape sequences.
// Inspired by Orca's agent-status.ts — reads OSC title sequences to detect agent state
// without requiring IPC protocol overhead.

import type { AgentStatus } from "@exegol/shared";

// ─── Agent title indicators ─────────────────────────────────────────────────

const CLAUDE_IDLE = "\u2733"; // ✳ (eight-spoked asterisk)
const GEMINI_WORKING = "\u2726"; // ✦
const GEMINI_IDLE = "\u25C7"; // ◇
const GEMINI_PERMISSION = "\u270B"; // ✋

const WORKING_KEYWORDS = ["working", "thinking", "running"];
const IDLE_KEYWORDS = ["ready", "idle", "done"];
const PERMISSION_KEYWORDS = ["action required", "permission", "waiting"];
const AGENT_NAMES = ["claude", "codex", "gemini", "opencode", "aider", "goose", "crush"];

type TitleStatus = "working" | "idle" | "permission" | null;

/**
 * Detect agent status from terminal title string.
 * Returns null if title doesn't match any known agent pattern.
 */
export function detectStatusFromTitle(title: string): TitleStatus {
  if (!title) return null;

  // Gemini CLI symbols (most specific)
  if (title.includes(GEMINI_PERMISSION)) return "permission";
  if (title.includes(GEMINI_WORKING)) return "working";
  if (title.includes(GEMINI_IDLE)) return "idle";

  // Claude Code: ✳ = idle, ". " prefix = working, "* " = idle
  if (title.startsWith(`${CLAUDE_IDLE} `) || title === CLAUDE_IDLE) return "idle";
  if (title.startsWith(". ")) return "working";
  if (title.startsWith("* ")) return "idle";

  // Braille spinner (U+2800–U+28FF) = working
  for (const char of title) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && cp >= 0x2800 && cp <= 0x28ff) return "working";
  }

  // Keyword matching (requires agent name in title)
  const lower = title.toLowerCase();
  const hasAgentName = AGENT_NAMES.some((n) => lower.includes(n));
  if (!hasAgentName) return null;

  if (PERMISSION_KEYWORDS.some((k) => lower.includes(k))) return "permission";
  if (IDLE_KEYWORDS.some((k) => lower.includes(k))) return "idle";
  if (WORKING_KEYWORDS.some((k) => lower.includes(k))) return "working";

  return "idle";
}

/**
 * Map title-based status to our AgentStatus type.
 */
export function titleStatusToAgentStatus(ts: TitleStatus): AgentStatus | null {
  switch (ts) {
    case "working":
      return "running";
    case "idle":
      // "idle" means the agent is waiting for input, NOT that it completed.
      // "completed" should only come from onExit (process actually terminated).
      return "waiting_input";
    case "permission":
      return "waiting_input";
    default:
      return null;
  }
}

// ─── OSC Title Parser ───────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC + BEL are valid terminal control codes
const OSC_TITLE_REGEX = /\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

/**
 * Extract terminal title from PTY output containing OSC escape sequences.
 * Returns the last title found in the data, or null if none.
 */
export function extractTitleFromData(data: string): string | null {
  let lastTitle: string | null = null;
  OSC_TITLE_REGEX.lastIndex = 0;
  for (;;) {
    const match = OSC_TITLE_REGEX.exec(data);
    if (!match) break;
    if (match[1]) lastTitle = match[1];
  }
  return lastTitle;
}

/**
 * Tracker: monitors PTY data for title changes, detects agent status transitions.
 * Calls onStatusChange when agent status changes based on terminal title.
 */
export function createTitleStatusTracker(
  onStatusChange: (status: AgentStatus, title: string) => void,
): (data: string) => void {
  let lastStatus: TitleStatus = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return (data: string) => {
    const title = extractTitleFromData(data);
    if (!title) return;

    const newStatus = detectStatusFromTitle(title);
    if (newStatus === null || newStatus === lastStatus) return;

    lastStatus = newStatus;
    // Debounce: Gemini updates title per-keystroke, batch into 500ms windows
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const agentStatus = titleStatusToAgentStatus(newStatus);
      if (agentStatus) onStatusChange(agentStatus, title);
    }, 500);
  };
}
