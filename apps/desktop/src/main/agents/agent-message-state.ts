/**
 * T165 — where every inter-agent message is, and what became of it.
 *
 * Split out of agent-messaging.ts: this module knows nothing about queues or
 * terminals. Since T170.1 the durable half (outcomes, idempotency) lives on the
 * `messages` row — what is left here is the short-lived bookkeeping that SHOULD
 * die with the process: the 30s content-dedup window and which injections are
 * still waiting on a turn boundary.
 *
 * The queued-vs-delivered DERIVATION stays with the queue, in agent-messaging.ts,
 * because only that module has both halves — duplicating the answer is what once
 * made agent_send and message_status contradict each other.
 */

import type Database from "libsql";
import {
  getMessageDelivery,
  type MessageDeliveryState,
  setMessageDeliveryState,
} from "../db/queries/messages";

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

export type { MessageDeliveryState };

// The dedup window stays in memory on purpose: it is a 30s "the model sent the
// same sentence twice" guard, not a durability promise.
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60_000;

export function pruneExpiring(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, e] of recentSends) {
    if (now - e.at > DEDUP_WINDOW_MS) recentSends.delete(key);
  }
}

/** Everything after the send. `queued` is the INSERT's own business. */
type MessageOutcome = Exclude<MessageDeliveryState, "queued">;

export function setOutcome(
  db: Database.Database,
  messageId: string,
  outcome: MessageOutcome,
): void {
  setMessageDeliveryState(db, messageId, outcome);
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
export function markConsumed(db: Database.Database, agentId: string): void {
  const ids = awaitingConsumption.get(agentId);
  if (!ids?.length) return;
  awaitingConsumption.delete(agentId);
  for (const id of ids) setOutcome(db, id, "consumed");
}

/** Read-only view for the queue module's delivery-state derivation. */
export function getMessageEntry(
  db: Database.Database,
  messageId: string,
): { fromAgentId: string; toAgentId: string; outcome?: MessageDeliveryState } | undefined {
  const row = getMessageDelivery(db, messageId);
  if (!row?.fromAgentId || !row.toAgentId) return undefined;
  return {
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    outcome: row.state ?? undefined,
  };
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
