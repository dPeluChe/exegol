import type { AgentStatus } from "@exegol/shared";

/** A Claude question's attention item comes with the move into waiting_input */
const QUESTION_WINDOW_MS = 5_000;
/** The item is stamped when the push arrives, just after main's status change */
const CLOCK_SLACK_MS = 1_000;

/** Claude asks now: an action_needed item raised as it started waiting. One raised later on the
 *  same wait is the idle reminder (hooks written before the matcher, or kept in the inbox) */
export function isClaudeQuestion(
  item: { level: string; timestamp: number; paneId?: string } | undefined,
  agent: { cliType: string; status: AgentStatus; activitySince?: number },
): boolean {
  if (agent.cliType !== "claude-code" || agent.status !== "waiting_input") return false;
  if (item?.level !== "action_needed" || item.paneId) return false;
  if (agent.activitySince === undefined) return true;
  const after = item.timestamp - agent.activitySince;
  return after >= -CLOCK_SLACK_MS && after <= QUESTION_WINDOW_MS;
}
