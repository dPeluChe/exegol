/**
 * Variables a running agent session sets for its own children. Exegol started from inside one
 * (a dev build in an agent's terminal) passed them on: with CLAUDE_CODE_CHILD_SESSION set,
 * Claude silently stops writing its transcript (history and resume lose the session). User
 * configuration (CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK...) is kept
 */
const SESSION_MARKERS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
  "CODEX_THREAD_ID",
]);

/** The environment for a CLI Exegol starts: without another session's markers or Exegol's own */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !SESSION_MARKERS.has(k) && !k.startsWith("EXEGOL_")),
  );
}
