import { getAgentManager } from "../agents/manager";
import { getDb } from "../db/client";
import { broadcast } from "../lib/event-bus";
import { createLogLimiter, suppressedNote } from "../lib/log-limiter";
import { logger } from "../lib/logger";
import { getPtyHost } from "./pty-host";

const limiter = createLogLimiter(10_000);

/**
 * A view asks for a PTY grid (a pane's fit, or a Dashboard card that sizes the session).
 * Compared with the size held for a reattach when there is one: comparing with the model's
 * stale grid dropped a pane taking its size back from a card, and the card's size won.
 */
export function requestPtyResize(agentId: string, cols: number, rows: number): void {
  const host = getPtyHost();
  const { size: before, held } = host.requestedSize(agentId);
  // A drag re-sends the same grid every frame; each would be a sidecar RPC
  if (before?.cols === cols && before?.rows === rows) return;
  logResize(agentId, before, cols, rows, held);
  getAgentManager().resize(agentId, cols, rows);
  // Remembered so a reattach rebuilds the model at the size the output was drawn at
  try {
    getDb()
      .prepare("UPDATE agents SET pty_cols = ?, pty_rows = ? WHERE id = ?")
      .run(cols, rows, agentId);
  } catch {
    /* not an agent row (or db closing): the default size is only a fallback */
  }
  // Overview mirrors follow the owner's size; they never resize the PTY themselves
  if (before) broadcast("terminal:resized", agentId, cols, rows);
}

/** Sizes only. A held size replaced is always logged (startup only), the rest once per 10 s with
 *  the count of lines held back */
function logResize(
  agentId: string,
  before: { cols: number; rows: number } | null,
  cols: number,
  rows: number,
  held: boolean,
): void {
  const suppressed = limiter.take(agentId, Date.now(), held);
  if (suppressed === null) return;
  const from = before ? `${before.cols}x${before.rows}` : "none";
  logger.info(
    `[Resize] ${agentId} ${from} -> ${cols}x${rows}${held ? " (held for reattach)" : ""}${suppressedNote(suppressed)}`,
  );
}
