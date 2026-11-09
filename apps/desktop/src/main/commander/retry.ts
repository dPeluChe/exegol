import type Database from "libsql";
import { chatTurns } from "../agents/session-chat";

const RETRYABLE =
  /reach the API|went to sleep|connection (lost|closed|error)|stopped arriving|unable to connect|overloaded|timed? ?out|\b5\d\d\b|ECONN\w+|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|stream disconnected|fetch failed/i;
/** Its own to fix: a retry would fail the same way */
const PERSONS = /log ?in|safeguards|\b40[0-4]\b|credit|billing|quota/i;
const HEAD_CHARS = 300;

/** A turn that ended on an error a retry can get past: the API or the network, not the account */
export function retryableError(lastTurnText: string): boolean {
  const head = lastTurnText.trim().slice(0, HEAD_CHARS);
  if (!/^(\W{0,3})?(API Error|stream error|Error:)/i.test(head)) return false;
  return RETRYABLE.test(head) && !PERSONS.test(head);
}

/** Read from the session's own transcript; false when it has none or it cannot be read */
export async function stoppedOnError(db: Database.Database, agentId: string): Promise<boolean> {
  try {
    const page = await chatTurns(db, agentId, undefined);
    const last = page.turns.filter((t) => t.role !== "tool").at(-1);
    return last?.role === "assistant" && retryableError(last.text);
  } catch {
    return false;
  }
}

const PER_HOUR = 3;
const HOUR_MS = 60 * 60_000;
const tries = new Map<string, number[]>();

/** At most 3 retries a session an hour: an outage is not fought with a loop */
export function takeRetry(agentId: string, now = Date.now()): boolean {
  const recent = (tries.get(agentId) ?? []).filter((at) => now - at < HOUR_MS);
  if (recent.length >= PER_HOUR) {
    tries.set(agentId, recent);
    return false;
  }
  tries.set(agentId, [...recent, now]);
  return true;
}

export const RETRY_TEXT =
  "Your last turn stopped on an API or network error. Continue where you left off.";
