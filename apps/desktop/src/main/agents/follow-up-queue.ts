import { randomUUID } from "node:crypto";
import { type FollowUpItem, type FollowUpsChangedEvent, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { getAgent } from "../db/queries/agents";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { injectNow, sanitizeAgentMessage } from "./agent-message-injection";
import type { PendingMessage } from "./agent-message-state";
import {
  isAgentAwaitingApproval,
  msSinceAgentOutput,
  queuedFor,
  queueForBoundary,
  takeQueued,
} from "./agent-messaging";

const MAX_FOLLOW_UPS = 10;
const MAX_CHARS = 12_000;
export const STEER_TIMEOUT_MS = 20_000;
const STEER_POLL_MS = 250;
// Claude fires no Stop hook on an interrupt: going quiet after the Esc is the boundary
const STEER_QUIET_MS = 1_500;

export class FollowUpError extends Error {}

export function listFollowUps(agentId: string): FollowUpItem[] {
  return queuedFor(agentId)
    .filter((p) => p.followUp)
    .map((p) => ({ id: p.messageId, text: p.text }));
}

function notify(agentId: string): void {
  const event: FollowUpsChangedEvent = { agentId, items: listFollowUps(agentId) };
  broadcast("agent:follow-ups", event);
}

function isQueued(agentId: string, id: string): boolean {
  return queuedFor(agentId).some((p) => p.messageId === id);
}

/** At its input prompt; a terminal whose CLI exited back to the shell is idle too, but not there */
function atPrompt(db: Database.Database, agentId: string): boolean {
  const agent = getAgent(db, agentId);
  if (!agent || isAgentAwaitingApproval(agentId)) return false;
  return agent.status === "waiting_input" || (agent.status === "idle" && !agent.launchedInShell);
}

function prepare(db: Database.Database, agentId: string, text: string): PendingMessage {
  const agent = getAgent(db, agentId);
  const live = !!agent && LIVE_STATUSES.has(agent.status);
  if (
    !agent ||
    agent.cliType === "shell" ||
    !live ||
    (agent.launchedInShell && agent.status === "idle")
  ) {
    throw new FollowUpError("Only a live agent session takes follow-ups");
  }
  const clean = sanitizeAgentMessage(text).trim();
  if (!clean) throw new FollowUpError("Empty follow-up");
  if (clean.length > MAX_CHARS) throw new FollowUpError(`Too long (max ${MAX_CHARS} characters)`);
  if (listFollowUps(agentId).length >= MAX_FOLLOW_UPS) {
    throw new FollowUpError(`The queue is full (${MAX_FOLLOW_UPS})`);
  }
  return {
    messageId: `fu_${randomUUID()}`,
    fromAgentId: "user",
    fromLabel: "user",
    replyTarget: "",
    toAgentId: agentId,
    text: clean,
    followUp: { onDelivered: () => notify(agentId) },
    expectsReply: false,
    senderProject: null,
    crossProject: false,
    inReplyTo: null,
  };
}

/** "Send later": typed at the next turn boundary, or now when the agent already sits at its prompt
 *  with nothing queued ahead */
export function queueFollowUp(
  db: Database.Database,
  agentId: string,
  text: string,
): { id: string; delivered: boolean } {
  const pending = prepare(db, agentId, text);
  const id = pending.messageId;
  if (queuedFor(agentId).length === 0 && atPrompt(db, agentId) && injectNow(pending)) {
    return { id, delivered: true };
  }
  queueForBoundary(pending);
  notify(agentId);
  return { id, delivered: false };
}

export function removeFollowUp(agentId: string, id: string): boolean {
  // Only follow-ups: agent_send messages share this queue
  if (!queuedFor(agentId).some((p) => p.messageId === id && p.followUp)) return false;
  takeQueued(agentId, id);
  notify(agentId);
  return true;
}

/** The session ended (or its CLI exited to the shell): nothing queued may reach it */
export function dropFollowUps(agentId: string): void {
  const ours = listFollowUps(agentId);
  for (const item of ours) takeQueued(agentId, item.id);
  if (ours.length) notify(agentId);
}

/** Resolves true once `check` holds, false when `timeoutMs` passes first */
export function waitUntil(
  check: () => boolean,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (check()) resolve(true);
      else if (Date.now() - started >= timeoutMs) resolve(false);
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Steer: interrupt the turn (Esc), wait for the prompt, type the message. It waits at the front of
 * the queue, so a boundary that comes first delivers it; past the cap it stays queued.
 */
export async function steerFollowUp(
  db: Database.Database,
  agentId: string,
  text: string,
): Promise<{ id: string; delivered: boolean }> {
  const pending = prepare(db, agentId, text);
  const id = pending.messageId;
  if (atPrompt(db, agentId) && injectNow(pending)) return { id, delivered: true };

  queueForBoundary(pending, true);
  notify(agentId);
  getPtyHost().write(agentId, "\x1b");
  const escAt = Date.now();
  const ready = await waitUntil(
    () =>
      !isQueued(agentId, id) ||
      atPrompt(db, agentId) ||
      (Date.now() - escAt >= STEER_QUIET_MS &&
        msSinceAgentOutput(agentId) >= STEER_QUIET_MS &&
        !isAgentAwaitingApproval(agentId)),
    { timeoutMs: STEER_TIMEOUT_MS, intervalMs: STEER_POLL_MS },
  );
  if (!isQueued(agentId, id)) return { id, delivered: true };
  if (!ready) {
    logger.info(
      `[FollowUp] Steer for ${agentId}: no prompt within ${STEER_TIMEOUT_MS / 1000}s, left queued`,
    );
    return { id, delivered: false };
  }
  takeQueued(agentId, id);
  const delivered = injectNow(pending);
  notify(agentId);
  return { id, delivered };
}
