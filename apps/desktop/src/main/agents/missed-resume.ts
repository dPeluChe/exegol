/**
 * Spawns that used a CLI's generic "continue last" flag with no way to check for a session first
 * (no history adapter, or its store unreadable). Such a CLI exits with an error within a second
 * when the folder has none (`devin -c`: "No sessions to continue"); the agent then ended failed.
 */
const blindResumes = new Map<string, number>();

/** A missing session fails at startup; a later exit is the session itself ending */
export const MISSED_RESUME_WINDOW_MS = 8_000;

export function noteBlindResume(agentId: string, now = Date.now()): void {
  blindResumes.set(agentId, now);
}

/** Typed input means the user is in the session. Terminal replies (ESC sequences) are not typing */
export function noteAgentInput(agentId: string, data: string): void {
  if (blindResumes.has(agentId) && !data.startsWith("\x1b")) blindResumes.delete(agentId);
}

/** Whether this exit was a blind resume that found nothing: consumed, so it answers once per spawn */
export function takeMissedResume(
  agentId: string,
  exitCode: number,
  stopRequested: boolean,
  now = Date.now(),
): boolean {
  const at = blindResumes.get(agentId);
  blindResumes.delete(agentId);
  return (
    at !== undefined && exitCode !== 0 && !stopRequested && now - at <= MISSED_RESUME_WINDOW_MS
  );
}
