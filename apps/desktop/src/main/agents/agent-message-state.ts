/**
 * T165 — where every inter-agent message is, and what became of it.
 *
 * Split out of agent-messaging.ts: this module OWNS the bookkeeping (who sent
 * what to whom, idempotency keys, content dedup, terminal outcomes) and knows
 * nothing about queues or terminals. The queued-vs-delivered DERIVATION lives
 * with the queue, in agent-messaging.ts, because only that module has both
 * halves — duplicating the answer here is what once made agent_send and
 * message_status contradict each other.
 */

const DEDUP_WINDOW_MS = 30_000;

/** Content-addressed record of what an identical send already resolved to. */
const recentSends = new Map<string, { at: number; messageId: string }>();

export interface PendingMessage {
  messageId: string;
  fromAgentId: string;
  /** "claude-code · fix-auth-flow" — human-legible sender line for the injection. */
  fromLabel: string;
  /** What the receiver should pass to agent_send to reply: sender alias or id. */
  replyTarget: string;
  toAgentId: string;
  text: string;
  /** Antonio 2026-08-12: explicit cycle — sender states whether it awaits a
   *  reply, so the receiver knows to close the loop (or not). */
  expectsReply: boolean;
  /** Sender's project name + path — cross-project feedback must carry its
   *  origin ("son de diferentes orígenes pero hablan del mismo"). */
  senderProject: { name: string; path: string } | null;
  crossProject: boolean;
  /** T165: id of the message this one answers, so a room stays threaded. */
  inReplyTo: string | null;
}

// `delivered` means the text reached the terminal; `consumed` means the agent
// finished a turn afterwards, i.e. it actually processed it. The sender used to
// have no visibility between "queued" and a reply arriving (Juanito, 2026-08-13:
// "delivered es transporte, no lectura").
export type MessageDeliveryState =
  | "queued"
  | "delivered"
  | "consumed"
  | "cancelled"
  | "undeliverable";

const MESSAGE_STATE_TTL_MS = 60 * 60_000;
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
// Only `undeliverable` is stored: queued-vs-delivered is DERIVED from the live
// queue, so there is exactly one source of truth. Storing it twice is how
// agent_send came to answer "queued" for a message message_status called
// "delivered" — the two tools disagreeing in the very case they exist for.
const messageState = new Map<
  string,
  {
    toAgentId: string;
    fromAgentId: string;
    at: number;
    /** Terminal states, stored because they can't be derived from the queue. */
    outcome?: "undeliverable" | "cancelled" | "consumed";
  }
>();
const idempotency = new Map<string, { messageId: string; at: number }>();

// The maps are swept on a timer rather than per send: a rate-limited agent
// hammering agent_send used to pay a full scan of both maps per rejected call.
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60_000;

export function pruneExpiring(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [id, s] of messageState) {
    if (now - s.at > MESSAGE_STATE_TTL_MS) messageState.delete(id);
  }
  for (const [key, e] of idempotency) {
    if (now - e.at > IDEMPOTENCY_TTL_MS) idempotency.delete(key);
  }
  for (const [key, e] of recentSends) {
    if (now - e.at > DEDUP_WINDOW_MS) recentSends.delete(key);
  }
}

export function trackMessage(p: PendingMessage): void {
  messageState.set(p.messageId, {
    toAgentId: p.toAgentId,
    fromAgentId: p.fromAgentId,
    at: Date.now(),
  });
}

type MessageOutcome = NonNullable<ReturnType<typeof messageState.get>>["outcome"];

/** The one place an outcome is written. A terminal outcome (cancelled /
 *  undeliverable) is never overwritten — reporting a cancelled message as read
 *  would be worse than reporting nothing. */
export function setOutcome(messageId: string, outcome: NonNullable<MessageOutcome>): void {
  const entry = messageState.get(messageId);
  if (entry && !entry.outcome) entry.outcome = outcome;
}

// Messages injected into an agent that has not yet closed a turn. The next
// boundary is the observable moment it processed them.
const awaitingConsumption = new Map<string, string[]>();

export function noteInjected(p: PendingMessage): void {
  const ids = awaitingConsumption.get(p.toAgentId) ?? [];
  ids.push(p.messageId);
  awaitingConsumption.set(p.toAgentId, ids);
}

/** Called at a turn boundary: everything injected before it has now been read. */
export function markConsumed(agentId: string): void {
  const ids = awaitingConsumption.get(agentId);
  if (!ids?.length) return;
  awaitingConsumption.delete(agentId);
  for (const id of ids) setOutcome(id, "consumed");
}

/** Read-only view for the queue module's delivery-state derivation. */
export function getMessageEntry(messageId: string) {
  return messageState.get(messageId);
}

export function rememberIdempotency(key: string, messageId: string, at: number): void {
  idempotency.set(key, { messageId, at });
}

export function findIdempotent(key: string): string | undefined {
  return idempotency.get(key)?.messageId;
}

export function rememberSend(dedupKey: string, messageId: string, at: number): void {
  recentSends.set(dedupKey, { at, messageId });
}

/** The message id an identical send resolved to, while still inside the window. */
export function findRecentSend(dedupKey: string, now: number): string | undefined {
  const last = recentSends.get(dedupKey);
  return last && now - last.at < DEDUP_WINDOW_MS ? last.messageId : undefined;
}

/** Runtime state keyed by agent, dropped when its session ends. */
export function forgetAgentMessageState(agentId: string): void {
  awaitingConsumption.delete(agentId);
}

/** Idempotency keys are prefixed with the sender id, so a new agent reusing an
 *  id can never inherit them. */
export function forgetSenderIdempotency(agentId: string): void {
  for (const key of idempotency.keys()) {
    if (key.startsWith(`${agentId}:`)) idempotency.delete(key);
  }
}
