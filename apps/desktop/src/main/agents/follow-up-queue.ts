import { type Agent, acceptsFollowUps, STEER_TIMEOUT_MS } from "@exegol/shared";
import type Database from "libsql";
import { getAgent } from "../db/queries/agents";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { injectNow, isEchoingInjection, sanitizeAgentMessage } from "./agent-message-injection";
import {
  enqueue,
  isAgentAwaitingApproval,
  listFollowUps,
  msSinceAgentOutput,
  notifyFollowUps,
  queuedFor,
  takeQueued,
} from "./agent-messaging";
import { interruptKeyOf } from "./cli-catalog";

export { listFollowUps };

const MAX_FOLLOW_UPS = 10;
export const FOLLOW_UP_MAX_CHARS = 12_000;
const STEER_POLL_MS = 250;
// Claude fires no Stop hook on an interrupt: going quiet after the Esc is the boundary
const STEER_QUIET_MS = 1_500;

export class FollowUpError extends Error {}

function liveAgent(db: Database.Database, agentId: string): Agent {
  const agent = getAgent(db, agentId);
  if (!agent || !acceptsFollowUps(agent)) {
    throw new FollowUpError("Only a live agent session takes follow-ups");
  }
  return agent;
}

function checkLength(text: string): string {
  if (text.length > FOLLOW_UP_MAX_CHARS) {
    throw new FollowUpError(`Too long (max ${FOLLOW_UP_MAX_CHARS} characters)`);
  }
  return text;
}

function cleanText(text: string): string {
  const clean = sanitizeAgentMessage(text).trim();
  if (!clean) throw new FollowUpError("Empty follow-up");
  return checkLength(clean);
}

/** Through the agent_send queue: same boundary delivery, no messages row, ahead of agent messages */
function send(
  db: Database.Database,
  agent: Agent,
  text: string,
  first: boolean,
  onDelivered?: () => void,
): { id: string; delivered: boolean } {
  if (listFollowUps(agent.id).length >= MAX_FOLLOW_UPS) {
    throw new FollowUpError(`The queue is full (${MAX_FOLLOW_UPS})`);
  }
  const { messageId, delivered } = enqueue(
    db,
    agent,
    {
      fromAgentId: "user",
      fromLabel: "user",
      replyTarget: "",
      text,
      expectsReply: false,
      senderProject: null,
      crossProject: false,
      inReplyTo: null,
      onDelivered: () => {
        onDelivered?.();
        notifyFollowUps(agent.id);
      },
    },
    null,
    first,
  );
  if (!delivered) notifyFollowUps(agent.id);
  return { id: messageId, delivered };
}

/** "Send later": typed at the next turn boundary, or now when the agent already sits at its prompt
 *  with no follow-up ahead */
export function queueFollowUp(
  db: Database.Database,
  agentId: string,
  text: string,
): { id: string; delivered: boolean } {
  return send(db, liveAgent(db, agentId), cleanText(text), false);
}

const isFollowUp = (id: string) => (p: { messageId: string; onDelivered?: () => void }) =>
  p.messageId === id && !!p.onDelivered;

export function removeFollowUp(agentId: string, id: string): boolean {
  // Only follow-ups: agent_send messages share this queue
  if (!takeQueued(agentId, isFollowUp(id))) return false;
  notifyFollowUps(agentId);
  return true;
}

/** Its CLI exited to the shell: nothing queued may reach the shell prompt */
export function dropFollowUps(agentId: string): void {
  let dropped = 0;
  while (takeQueued(agentId, (p) => !!p.onDelivered)) dropped++;
  if (dropped) notifyFollowUps(agentId);
}

/** At its input prompt; a terminal whose CLI exited back to the shell is idle too, but not there */
function atPrompt(db: Database.Database, agentId: string): boolean {
  const agent = getAgent(db, agentId);
  if (!agent || isAgentAwaitingApproval(agentId)) return false;
  return agent.status === "waiting_input" || (agent.status === "idle" && !agent.launchedInShell);
}

/** Resolves true once `check` holds, false when `timeoutMs` passes first */
function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (check()) resolve(true);
      else if (Date.now() - started >= timeoutMs) resolve(false);
      else setTimeout(tick, STEER_POLL_MS);
    };
    tick();
  });
}

/** One Steer per agent: a second one while it waits joins its text (no second interrupt) */
const steering = new Map<
  string,
  { id: string; done: Promise<{ id: string; delivered: boolean }> }
>();

/**
 * Steer: interrupt the turn, wait for the prompt, type the message. It waits at the front of the
 * queue, so a boundary that comes first delivers it; past the cap it stays queued.
 */
export async function steerFollowUp(
  db: Database.Database,
  agentId: string,
  text: string,
): Promise<{ id: string; delivered: boolean }> {
  const agent = liveAgent(db, agentId);
  const interrupt = interruptKeyOf(agent.cliType);
  if (!interrupt) throw new FollowUpError("This CLI has no interrupt key: use Send later");
  const clean = cleanText(text);

  const inFlight = steering.get(agentId);
  const joined = inFlight && queuedFor(agentId).find(isFollowUp(inFlight.id));
  if (inFlight && joined) {
    joined.text = checkLength(`${joined.text}\n\n${clean}`);
    notifyFollowUps(agentId);
    return inFlight.done;
  }

  let delivered = false;
  const sent = send(db, agent, clean, true, () => {
    delivered = true;
  });
  if (sent.delivered) return sent;

  getPtyHost().write(agentId, interrupt);
  const done = typeAtPrompt(db, agentId, sent.id, Date.now())
    .then(() => ({ id: sent.id, delivered }))
    .finally(() => {
      if (steering.get(agentId)?.done === done) steering.delete(agentId);
    });
  steering.set(agentId, { id: sent.id, done });
  return done;
}

async function typeAtPrompt(
  db: Database.Database,
  agentId: string,
  id: string,
  interruptAt: number,
): Promise<void> {
  const queued = () => queuedFor(agentId).some(isFollowUp(id));
  // Same quiet test as the sweep, after the interrupt and never over our own echo
  const quiet = () =>
    Date.now() - interruptAt >= STEER_QUIET_MS &&
    msSinceAgentOutput(agentId) >= STEER_QUIET_MS &&
    !isEchoingInjection(agentId) &&
    !isAgentAwaitingApproval(agentId);
  const ready = await waitUntil(
    () => !queued() || atPrompt(db, agentId) || quiet(),
    STEER_TIMEOUT_MS,
  );
  if (!queued()) return;
  if (!ready) {
    logger.info(
      `[FollowUp] Steer for ${agentId}: no prompt within ${STEER_TIMEOUT_MS / 1000}s, left queued`,
    );
    return;
  }
  const pending = takeQueued(agentId, isFollowUp(id));
  if (pending && !injectNow(pending)) notifyFollowUps(agentId);
}
