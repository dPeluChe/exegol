import type { SessionTurn } from "@exegol/shared";

/**
 * The reply to read on its own after a chat push: the chat's last turn when it is the agent's text,
 * arrived after the chat opened and was not read yet. Mid-turn the last turn is the person's
 * message or a tool call, so only a finished reply qualifies.
 */
export function liveReply(
  turns: readonly SessionTurn[],
  seen: ReadonlySet<string>,
  lastRead: string | null,
): SessionTurn | null {
  const last = turns.at(-1);
  if (last?.role !== "assistant" || seen.has(last.id) || last.id === lastRead) return null;
  return last;
}
