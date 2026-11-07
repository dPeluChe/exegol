/**
 * T157 — cross-provider inter-agent messaging.
 *
 * This module owns admission and routing: validation, rate limits, dedup, and
 * the decision of when a message may enter a target's terminal (only at a turn
 * boundary, never mid-generation, never over a permission dialog). Queue state
 * lives in agent-message-queue.ts, the quiescence sweep in agent-message-sweep.ts,
 * framing and the PTY write in agent-message-injection.ts, delivery bookkeeping
 * in agent-message-state.ts, T162 links in agent-links.ts.
 */

import { randomUUID } from "node:crypto";
import { type Agent, acceptsFollowUps, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { getDb } from "../db/client";
// Direct module imports (not the queries barrel): the barrel pulls
// parallel-runs → spawn-env, which imports this module — cycle at init time.
import { findLiveAgentsByAlias, getAgent } from "../db/queries/agents";
import { findMessageByClientKey, sendMessage } from "../db/queries/messages";
import { getProject } from "../db/queries/projects";
import { logger } from "../lib/logger";
import {
  forgetAgentInjectionState,
  injectNow,
  sanitizeAgentMessage as sanitize,
} from "./agent-message-injection";
import {
  countQueued,
  drainQueue,
  forgetQueueState,
  hasQueuedMessages,
  holdsDelivery,
  markUndeliverable,
  notifyFollowUps,
  queuedFor,
  shiftQueued,
  storeQueue,
  takeQueued,
} from "./agent-message-queue";
import {
  findRecentSend,
  forgetAgentMessageState,
  getMessageEntry,
  type MessageDeliveryState,
  markConsumed,
  type PendingMessage,
  pruneExpiring,
  rememberSend,
  setOutcome,
} from "./agent-message-state";
import { ensureSweep, forgetSweepState, stopSweep } from "./agent-message-sweep";

export {
  clearAgentLinks,
  fireAgentLinks,
  noteAgentHasLink,
  seedAgentLinkCache,
} from "./agent-links";
export { checkAgentMessages, isEchoingInjection } from "./agent-message-injection";

const MAX_QUEUE_PER_TARGET = 10;
// An assignment brief has to carry scope, rules AND validation criteria — at
// 4000 the coordinator's briefs were already brushing the ceiling and the
// pressure is to drop the criteria, which is the part that makes work reviewable.
const MAX_MESSAGE_CHARS = 12_000;
// N-agent rooms: dedup is per (sender, target, text), so a ring A→B→C→A never
// repeats a pair and would circulate forever. These bound the fleet as a whole.
const MAX_SENDS_PER_MINUTE = 12;
const MAX_TOTAL_QUEUED = 40;
const sendTimestamps = new Map<string, number[]>();

export class AgentMessagingError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}

/**
 * T172: withdraw a message that has not been delivered yet. Only the sender may
 * cancel, and only while it is still in our queue — once the text is in the
 * target's terminal it is out of our hands, and saying otherwise would be a lie.
 */
export function cancelQueuedMessage(
  db: Database.Database,
  messageId: string,
  senderAgentId: string,
): { cancelled: boolean; state: MessageDeliveryState | "unknown"; reason?: string } {
  const entry = getMessageEntry(db, messageId);
  if (!entry || entry.fromAgentId !== senderAgentId) {
    return { cancelled: false, state: "unknown", reason: "no message of yours with that id" };
  }
  if (!takeQueued(entry.toAgentId, (p) => p.messageId === messageId)) {
    const { state } = deriveState(entry, messageId);
    return {
      cancelled: false,
      state,
      reason: "already left the queue — send a follow-up message instead",
    };
  }
  setOutcome(db, messageId, "cancelled");
  return { cancelled: true, state: "cancelled" };
}

/** A re-send resolves to the original message, with its CURRENT delivery state
 *  (the first attempt may have been queued then delivered since). */
function duplicateResult(
  db: Database.Database,
  messageId: string,
  fromAgentId: string,
): { messageId: string; delivered: boolean; duplicate: true } {
  const { state } = getMessageDeliveryState(db, messageId, fromAgentId);
  return {
    messageId,
    // `consumed` is delivery that ALSO got read. Comparing against "delivered"
    // alone told a retry the message never landed precisely when it had landed
    // and been processed — the common case, since a delivered message flips to
    // consumed at the target's very next boundary.
    delivered: state === "delivered" || state === "consumed",
    duplicate: true,
  };
}

/** T165: answer "did my message actually land?" without re-sending it. */
export function getMessageDeliveryState(
  db: Database.Database,
  messageId: string,
  askerAgentId: string,
): { state: MessageDeliveryState | "unknown"; queuePosition?: number } {
  const entry = getMessageEntry(db, messageId);
  // Scoped to the asker's own conversations: a message id is not a capability
  // to inspect traffic between two other agents. (The sender/receiver ids go
  // NULL when an agent row is pruned, so an old message becomes unknown to
  // everyone — by which point nobody is left to ask.)
  if (!entry || (entry.fromAgentId !== askerAgentId && entry.toAgentId !== askerAgentId)) {
    return { state: "unknown" };
  }
  return deriveState(entry, messageId);
}

/** The LIVE queue stays authoritative for queued-vs-delivered — storing that
 *  twice is how agent_send once answered "queued" for a message message_status
 *  called "delivered". The row answers for everything else, which is what
 *  survives a restart. */
function deriveState(
  entry: { toAgentId: string; outcome?: MessageDeliveryState },
  messageId: string,
): { state: MessageDeliveryState; queuePosition?: number } {
  const idx = queuedFor(entry.toAgentId).findIndex((p) => p.messageId === messageId);
  if (idx !== -1) return { state: "queued", queuePosition: idx + 1 };
  return { state: entry.outcome ?? "delivered" };
}

/**
 * Validate, persist and route a message. Returns delivery state so the sender
 * (MCP tool / UI) can tell the difference between "landed" and "queued for the
 * target's next turn boundary".
 */
/** T160: resolve an agent_send target — exact id first, then unique
 *  case-insensitive alias among LIVE agents. Ambiguity is an error, not a guess. */
export function resolveTargetAgent(
  db: Database.Database,
  target: string,
): NonNullable<ReturnType<typeof getAgent>> {
  const byId = getAgent(db, target);
  if (byId) return byId;
  const byAlias = findLiveAgentsByAlias(db, target);
  if (byAlias.length === 1 && byAlias[0]) return byAlias[0];
  if (byAlias.length > 1) {
    throw new AgentMessagingError(
      `alias "${target}" matches ${byAlias.length} live agents (${byAlias.map((a) => a.id).join(", ")}) — use the id`,
      -32014,
    );
  }
  // Closing a pane deletes the row, so a target that was in your last
  // agents_list can legitimately be gone. Say that, instead of implying the
  // caller made the id up.
  throw new AgentMessagingError(
    `no live agent "${target}" — it was never running, or its session has since ended. Call agents_list again for the current fleet.`,
    -32602,
  );
}

export function sendAgentMessage(
  db: Database.Database,
  input: {
    fromAgentId: string;
    toAgentId: string;
    text: string;
    expectsReply?: boolean;
    /** System-originated (links): skip the LLM anti-spam dedup — recurrence is
     *  governed by the turn-transition edge, not the 30s window (simplify A6). */
    system?: boolean;
    /** T165: caller-supplied idempotency key — a retry after an ambiguous
     *  timeout returns the ORIGINAL result instead of sending twice. */
    clientKey?: string;
    /** T165: message this one answers (threading). */
    inReplyTo?: string;
  },
): { messageId: string; delivered: boolean; duplicate?: boolean } {
  const { fromAgentId } = input;
  const text = messageText(input.text);

  // Before ANY validation or rate accounting: a retry of a call that already
  // succeeded must be a no-op that reports the original outcome.
  pruneExpiring(Date.now());
  // The key is scoped to the sender by the unique index, so a new agent that
  // reuses an id can never inherit another's keys.
  if (input.clientKey) {
    const prior = findMessageByClientKey(db, fromAgentId, input.clientKey);
    if (prior) return duplicateResult(db, prior, fromAgentId);
  }

  const target = resolveTargetAgent(db, input.toAgentId);
  const toAgentId = target.id;
  if (toAgentId === fromAgentId) {
    throw new AgentMessagingError("cannot send a message to yourself", -32602);
  }
  assertReachable(target);

  const now = Date.now();
  const dedupKey = `${fromAgentId}→${toAgentId}:${text}`;
  if (!input.system) {
    // Identical text in the window is the same message: same answer as an explicit message_id
    const prior = findRecentSend(dedupKey, now);
    if (prior) return duplicateResult(db, prior, fromAgentId);
  }

  const recent = (sendTimestamps.get(fromAgentId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= MAX_SENDS_PER_MINUTE) {
    throw new AgentMessagingError(
      `rate limit: ${MAX_SENDS_PER_MINUTE} messages/minute per agent — wait before sending again`,
      -32016,
    );
  }
  recent.push(now);
  sendTimestamps.set(fromAgentId, recent);

  // Fleet-wide backpressure: many agents each holding a near-full queue.
  if (countQueued(agentMessageCount) >= MAX_TOTAL_QUEUED) {
    throw new AgentMessagingError("too many messages in flight across the fleet", -32017);
  }

  const sender = getAgent(db, fromAgentId);
  const senderTask = sender?.taskDescription?.slice(0, 60) ?? "";
  const fromLabel = sender
    ? (sender.alias ?? `${sender.cliType}${senderTask ? ` · ${senderTask}` : ""}`)
    : "unknown";

  const senderProject = sender ? getProject(db, sender.projectId) : null;

  const result = enqueue(
    db,
    target,
    {
      fromAgentId,
      fromLabel,
      replyTarget: sender?.alias ?? fromAgentId,
      text,
      expectsReply: input.expectsReply ?? true,
      senderProject: senderProject ? { name: senderProject.name, path: senderProject.path } : null,
      crossProject: !!sender && sender.projectId !== target.projectId,
      inReplyTo: input.inReplyTo ?? null,
    },
    { type: "text", clientKey: input.clientKey ?? null },
  );
  if (!input.system) rememberSend(dedupKey, result.messageId, now);
  return result;
}

function messageText(raw: string): string {
  const text = sanitize(raw).trim();
  if (!text) throw new AgentMessagingError("message must not be empty", -32602);
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new AgentMessagingError(`message too long (max ${MAX_MESSAGE_CHARS})`, -32602);
  }
  return text;
}

/** Live, and an agent: a plain terminal would run a pasted message as a command */
export function assertReachable(
  target: Pick<Agent, "cliType" | "status" | "launchedInShell">,
): void {
  if (!LIVE_STATUSES.has(target.status)) {
    throw new AgentMessagingError(`target agent is ${target.status} — not reachable`, -32011);
  }
  if (!acceptsFollowUps(target)) {
    throw new AgentMessagingError(
      "target is a plain terminal, not an agent: it cannot read messages. Call agents_list.",
      -32011,
    );
  }
}

/** User follow-ups have their own cap (follow-up-queue.ts) and do not count toward agent_send's */
const agentMessageCount = (queue: readonly PendingMessage[]) =>
  queue.reduce((n, p) => (p.onDelivered ? n : n + 1), 0);

/**
 * Queue cap, the message row (none for a user follow-up, `row: null`), then inject now or wait
 * for the boundary. `first` puts it at the head of the queue (Steer).
 */
export function enqueue(
  db: Database.Database,
  target: Pick<Agent, "id" | "cliType" | "status" | "launchedInShell">,
  message: Omit<PendingMessage, "messageId" | "toAgentId">,
  row: { type: "text" | "status"; clientKey?: string | null } | null,
  first = false,
): { messageId: string; delivered: boolean } {
  assertReachable(target);
  const queue = [...queuedFor(target.id)];
  if (row && agentMessageCount(queue) >= MAX_QUEUE_PER_TARGET) {
    throw new AgentMessagingError("target's message queue is full", -32013);
  }
  const messageId = row
    ? sendMessage(db, {
        fromAgentId: message.system ? null : message.fromAgentId,
        toAgentId: target.id,
        type: row.type,
        content: message.text,
        clientKey: row.clientKey ?? null,
        deliveryState: "queued",
      }).id
    : `fu_${randomUUID()}`;
  const pending: PendingMessage = { ...message, messageId, toAgentId: target.id };
  return { messageId, delivered: route(db, target.status, pending, queue, first) };
}

/**
 * Target at its prompt → inject immediately; otherwise queue for the boundary.
 * NEVER inject over a permission dialog, a question or a draft (see holdsDelivery).
 * User follow-ups go ahead of agent messages, and wait their turn behind earlier ones.
 */
function route(
  db: Database.Database,
  targetStatus: string,
  pending: PendingMessage,
  queue: PendingMessage[],
  first: boolean,
): boolean {
  const { toAgentId } = pending;
  const atIdlePrompt =
    (targetStatus === "waiting_input" || targetStatus === "idle") &&
    !(pending.onDelivered && !first && queue.some((p) => p.onDelivered)) &&
    !holdsDelivery(toAgentId);
  if (atIdlePrompt && injectNow(pending)) {
    if (!pending.onDelivered) setOutcome(db, pending.messageId, "delivered");
    return true;
  }
  if (first) queue.unshift(pending);
  else if (!pending.onDelivered) queue.push(pending);
  else {
    const firstAgentMessage = queue.findIndex((p) => !p.onDelivered);
    queue.splice(firstAgentMessage === -1 ? queue.length : firstAgentMessage, 0, pending);
  }
  storeQueue(toAgentId, queue);
  ensureSweep(deliverQueued);
  logger.info(
    `[AgentMsg] Queued ${pending.messageId} ${pending.fromAgentId} → ${toAgentId} (target ${targetStatus}, ${queue.length} pending)`,
  );
  return false;
}

const EXEGOL_SENDER = {
  fromAgentId: "exegol",
  replyTarget: "",
  expectsReply: false,
  senderProject: null,
  crossProject: false,
  inReplyTo: null,
  system: true,
} as const;

/**
 * A message from Exegol itself (PR watch), not from another agent: no sender row,
 * no reply expected, same queue and boundary rules as agent_send.
 */
export function sendSystemMessage(
  db: Database.Database,
  input: { toAgentId: string; source: string; text: string },
): { messageId: string; delivered: boolean } | null {
  const target = getAgent(db, input.toAgentId);
  if (!target) return null;
  try {
    return enqueue(
      db,
      target,
      {
        ...EXEGOL_SENDER,
        fromLabel: input.source,
        text: messageText(input.text.slice(0, MAX_MESSAGE_CHARS)),
      },
      { type: "status" },
    );
  } catch (err) {
    if (err instanceof AgentMessagingError) return null;
    throw err;
  }
}

/**
 * Turn-boundary hook (called from broadcastAgentStatus when a live agent lands
 * on `waiting_input`): deliver ONE pending message — the rest wait for the
 * next boundary so replies interleave naturally instead of flooding the prompt.
 */
export function deliverPendingAgentMessages(db: Database.Database, agentId: string): void {
  // This IS the boundary: anything injected before it has now been read.
  markConsumed(db, agentId);
  // A boundary can land on a dialog or a draft: the sweep tries again once it is gone
  if (holdsDelivery(agentId)) return;
  const next = shiftQueued(agentId);
  if (!next) return;
  if (!injectNow(next)) {
    // PTY gone — drop the queue; the messages stay persisted in the DB.
    const dropped = [next, ...drainQueue(agentId)];
    markUndeliverable(db, dropped);
    if (dropped.some((p) => p.onDelivered)) notifyFollowUps(agentId);
    logger.warn(
      `[AgentMsg] Target ${agentId} PTY gone — ${dropped.length} message(s) undeliverable`,
    );
    return;
  }
  if (!next.onDelivered) setOutcome(db, next.messageId, "delivered");
}

const deliverQueued = (agentId: string): void => deliverPendingAgentMessages(getDb(), agentId);

/**
 * Nothing queued can reach this session any more: its session ended, or its CLI went back to the
 * shell, where a late delivery would run as a command. Each sender waiting on a message is told,
 * otherwise it keeps waiting for a reply that can never come (Antonio 2026-08-12: "si cerramos
 * draco ya no debe tener en queue peticiones a él").
 */
export function failQueuedMessages(db: Database.Database, agentId: string): void {
  const pending = drainQueue(agentId);
  markUndeliverable(db, pending);
  if (pending.some((p) => p.onDelivered)) notifyFollowUps(agentId);
  const label = pending.length ? (getAgent(db, agentId)?.alias ?? agentId) : "";
  const notified = new Set<string>();
  for (const p of pending) {
    if (p.system || p.onDelivered || notified.has(p.fromAgentId)) continue;
    notified.add(p.fromAgentId);
    try {
      sendAgentMessage(db, {
        fromAgentId: agentId,
        toAgentId: p.fromAgentId,
        text: `(system) Your message never reached "${label}" — that session ended before its next turn. Don't wait for a reply; ask the user or pick another agent from agents_list.`,
        expectsReply: false,
        system: true,
      });
    } catch (err) {
      logger.warn(`[AgentMsg] Could not notify ${p.fromAgentId} that ${agentId} died: ${err}`);
    }
  }
  // Nothing left to watch — don't keep a timer alive for an empty fleet.
  if (!hasQueuedMessages()) stopSweep();
}

/** Drop runtime state for a stopped/removed agent; messages stay in the DB as an audit trail */
export function clearAgentMessageQueue(db: Database.Database, agentId: string): void {
  failQueuedMessages(db, agentId);
  // Its rate history and echo window die with it, or a new agent reusing the id would inherit them
  sendTimestamps.delete(agentId);
  forgetQueueState(agentId);
  forgetSweepState(agentId);
  forgetAgentMessageState(agentId);
  forgetAgentInjectionState(agentId);
}
