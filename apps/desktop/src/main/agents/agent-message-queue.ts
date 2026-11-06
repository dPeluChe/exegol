import type { FollowUpItem, FollowUpsChangedEvent } from "@exegol/shared";
import type Database from "libsql";
import { markMessagesUndeliverable } from "../db/queries/messages";
import { broadcast } from "../lib/event-bus";
import type { PendingMessage } from "./agent-message-state";

const queues = new Map<string, PendingMessage[]>();

export const queuedAgentIds = (): string[] => [...queues.keys()];

export const hasQueuedMessages = (): boolean => queues.size > 0;

export function countQueued(count: (queue: PendingMessage[]) => number): number {
  let total = 0;
  for (const q of queues.values()) total += count(q);
  return total;
}

export function storeQueue(agentId: string, queue: PendingMessage[]): void {
  queues.set(agentId, queue);
}

/** Next in line; a queue left empty is gone, so `queues` only ever holds agents with work */
export function shiftQueued(agentId: string): PendingMessage | undefined {
  const queue = queues.get(agentId);
  const next = queue?.shift();
  if (queue?.length === 0) queues.delete(agentId);
  return next;
}

export function drainQueue(agentId: string): PendingMessage[] {
  const pending = queues.get(agentId) ?? [];
  queues.delete(agentId);
  return pending;
}

export function forgetQueueState(agentId: string): void {
  queues.delete(agentId);
  agentsAwaitingApproval.delete(agentId);
}

// Agents blocked on a permission dialog are `waiting_input` in the DB exactly
// like idle ones — but injecting there ends with Enter, which confirms the
// highlighted option. Track the transient attention flag so a sender can never
// approve another agent's pending action.
const agentsAwaitingApproval = new Set<string>();

export function setAgentAwaitingApproval(agentId: string, awaiting: boolean): void {
  if (awaiting) agentsAwaitingApproval.add(agentId);
  else agentsAwaitingApproval.delete(agentId);
}

export function isAgentAwaitingApproval(agentId: string): boolean {
  return agentsAwaitingApproval.has(agentId);
}

/** The queue died; the row is where the sender can still learn that (follow-ups have no row). */
export function markUndeliverable(db: Database.Database, pending: PendingMessage[]): void {
  markMessagesUndeliverable(
    db,
    pending.filter((p) => !p.onDelivered).map((p) => p.messageId),
  );
}

export function queuedFor(agentId: string): readonly PendingMessage[] {
  return queues.get(agentId) ?? [];
}

/** Remove the first queued item that matches, without delivering it */
export function takeQueued(
  agentId: string,
  match: (p: PendingMessage) => boolean,
): PendingMessage | null {
  const queue = queues.get(agentId);
  const idx = queue?.findIndex(match) ?? -1;
  if (!queue || idx === -1) return null;
  const [taken] = queue.splice(idx, 1);
  if (queue.length === 0) queues.delete(agentId);
  return taken ?? null;
}

export function listFollowUps(agentId: string): FollowUpItem[] {
  return queuedFor(agentId)
    .filter((p) => p.onDelivered)
    .map((p) => ({ id: p.messageId, text: p.text }));
}

/** The renderer's follow-up count follows every change to them */
export function notifyFollowUps(agentId: string): void {
  const event: FollowUpsChangedEvent = { agentId, items: listFollowUps(agentId) };
  broadcast("agent:follow-ups", event);
}
