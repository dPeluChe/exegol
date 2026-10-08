import { stripTerminalReports } from "@exegol/shared";

/**
 * Spawns that used a CLI's generic "continue last" flag with no way to check for a session first
 * (no history adapter, or its store unreadable). Such a CLI exits with an error within a second
 * when the folder has none (`devin -c`: "No sessions to continue"); the agent then ended failed.
 */
const blindResumes = new Map<string, number>();

/** A missing session fails at startup; a later exit is the session itself ending */
export const MISSED_RESUME_WINDOW_MS = 8_000;

/** What each CLI prints when there is nothing to continue (verified 2026-10-08 where marked) */
const NO_SESSION_MESSAGES: Record<string, RegExp> = {
  // VERIFIED: "No conversation found to continue"
  "claude-code": /no conversation found to continue/i,
  // VERIFIED: "Error: No sessions to continue in this directory."
  devin: /no sessions to continue/i,
  // From the binary: "Error: No sessions found in current directory."
  "factory-droid": /no sessions found in current directory/i,
};
const GENERIC_NO_SESSION =
  /no (previous |saved )?(sessions?|conversations?|threads?) (found|to (continue|resume))/i;

/** Whether the CLI's last output says it had no session to continue (any other error stays) */
export function saidNoSession(cliType: string, tail: string): boolean {
  return (NO_SESSION_MESSAGES[cliType]?.test(tail) ?? false) || GENERIC_NO_SESSION.test(tail);
}

export function noteBlindResume(agentId: string, now = Date.now()): void {
  blindResumes.set(agentId, now);
}

/** Anything but the terminal's own replies (cursor reports, device attributes) is the user:
 *  typing, a paste, an arrow key */
export function noteAgentInput(agentId: string, data: string): void {
  if (blindResumes.has(agentId) && stripTerminalReports(data) !== "") blindResumes.delete(agentId);
}

/** Whether this exit was a blind resume that found nothing: consumed, so it answers once per spawn */
export function takeMissedResume(
  agentId: string,
  exit: { exitCode: number; stopRequested: boolean; cliType: string; tail: string },
  now = Date.now(),
): boolean {
  const at = blindResumes.get(agentId);
  blindResumes.delete(agentId);
  return (
    at !== undefined &&
    exit.exitCode !== 0 &&
    !exit.stopRequested &&
    now - at <= MISSED_RESUME_WINDOW_MS &&
    saidNoSession(exit.cliType, exit.tail)
  );
}
