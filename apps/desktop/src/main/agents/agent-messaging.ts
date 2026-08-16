/**
 * T157 — cross-provider inter-agent messaging.
 *
 * This module owns the QUEUE: validation, rate limits, dedup, and the decision
 * of when a message may enter a target's terminal (only at a turn boundary,
 * never mid-generation, never over a permission dialog). Framing and the PTY
 * write live in agent-message-injection.ts; delivery bookkeeping in
 * agent-message-state.ts; T162 links in agent-links.ts.
 */

import { LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
// Direct module imports (not the queries barrel): the barrel pulls
// parallel-runs → spawn-env, which imports this module — cycle at init time.
import { findLiveAgentsByAlias, getAgent } from "../db/queries/agents";
import { sendMessage } from "../db/queries/messages";
import { getProject } from "../db/queries/projects";
import { logger } from "../lib/logger";
import {
  forgetAgentInjectionState,
  injectNow,
  isEchoingInjection,
  sanitizeAgentMessage as sanitize,
} from "./agent-message-injection";
import {
  findIdempotent,
  findRecentSend,
  forgetAgentMessageState,
  getMessageEntry,
  type MessageDeliveryState,
  markConsumed,
  type PendingMessage,
  pruneExpiring,
  rememberSend,
  setOutcome,
  trackMessage,
} from "./agent-message-state";

export {
  clearAgentLinks,
  fireAgentLinks,
  noteAgentHasLink,
  seedAgentLinkCache,
} from "./agent-links";
// Re-exported so every existing import site keeps working after the split.
export {
  checkAgentMessages,
  isEchoingInjection,
  sanitizeAgentMessage,
} from "./agent-message-injection";
export type { MessageDeliveryState } from "./agent-message-state";

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

const queues = new Map<string, PendingMessage[]>();

/**
 * T172: withdraw a message that has not been delivered yet. Only the sender may
 * cancel, and only while it is still in our queue — once the text is in the
 * target's terminal it is out of our hands, and saying otherwise would be a lie.
 */
export function cancelQueuedMessage(
  messageId: string,
  senderAgentId: string,
): { cancelled: boolean; state: MessageDeliveryState | "unknown"; reason?: string } {
  const entry = getMessageEntry(messageId);
  if (!entry || entry.fromAgentId !== senderAgentId) {
    return { cancelled: false, state: "unknown", reason: "no message of yours with that id" };
  }
  const queue = queues.get(entry.toAgentId);
  const idx = queue?.findIndex((p) => p.messageId === messageId) ?? -1;
  if (!queue || idx === -1) {
    const state = getMessageDeliveryState(messageId, senderAgentId).state;
    return {
      cancelled: false,
      state,
      reason: "already left the queue — send a follow-up message instead",
    };
  }
  const [removed] = queue.splice(idx, 1);
  if (removed) setOutcome(messageId, "cancelled");
  if (queue.length === 0) queues.delete(entry.toAgentId);
  return { cancelled: true, state: "cancelled" };
}

/** A re-send resolves to the original message, with its CURRENT delivery state
 *  (the first attempt may have been queued then delivered since). */
function duplicateResult(
  messageId: string,
  fromAgentId: string,
): { messageId: string; delivered: boolean; duplicate: true } {
  const { state } = getMessageDeliveryState(messageId, fromAgentId);
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
  messageId: string,
  askerAgentId: string,
): { state: MessageDeliveryState | "unknown"; queuePosition?: number } {
  const entry = getMessageEntry(messageId);
  // Scoped to the asker's own conversations: a message id is not a capability
  // to inspect traffic between two other agents.
  if (!entry || (entry.fromAgentId !== askerAgentId && entry.toAgentId !== askerAgentId)) {
    return { state: "unknown" };
  }
  // The LIVE queue stays authoritative for queued-vs-delivered — storing that
  // twice is how agent_send once answered "queued" for a message message_status
  // called "delivered". The row answers for everything else, which is what
  // survives a restart.
  const idx = (queues.get(entry.toAgentId) ?? []).findIndex((p) => p.messageId === messageId);
  if (idx !== -1) return { state: "queued", queuePosition: idx + 1 };
  return { state: entry.outcome && entry.outcome !== "queued" ? entry.outcome : "delivered" };
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
  const text = sanitize(input.text).trim();
  if (!text) throw new AgentMessagingError("message must not be empty", -32602);
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new AgentMessagingError(`message too long (max ${MAX_MESSAGE_CHARS})`, -32602);
  }

  // Before ANY validation or rate accounting: a retry of a call that already
  // succeeded must be a no-op that reports the original outcome.
  pruneExpiring(Date.now());
  // The key is scoped to the sender by the unique index, so a new agent that
  // reuses an id can never inherit another's keys.
  if (input.clientKey) {
    const prior = findIdempotent(fromAgentId, input.clientKey);
    if (prior) return duplicateResult(prior, fromAgentId);
  }

  const target = resolveTargetAgent(db, input.toAgentId);
  const toAgentId = target.id;
  if (toAgentId === fromAgentId) {
    throw new AgentMessagingError("cannot send a message to yourself", -32602);
  }
  if (!LIVE_STATUSES.has(target.status)) {
    throw new AgentMessagingError(`target agent is ${target.status} — not reachable`, -32011);
  }

  const now = Date.now();
  const dedupKey = `${fromAgentId}→${toAgentId}:${text}`;
  if (!input.system) {
    // Identical text within the window is treated as the same message, not as
    // an error: throwing "duplicate throttled" at a sender retrying an
    // ambiguous timeout left it exactly where it started — unable to tell
    // whether the original landed. Same answer as an explicit message_id.
    const prior = findRecentSend(dedupKey, now);
    if (prior) return duplicateResult(prior, fromAgentId);
  }

  // Per-sender rate limit: one chatty agent can't flood a room, and a cycle
  // burns out instead of running forever.
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
  let totalQueued = 0;
  for (const q of queues.values()) totalQueued += q.length;
  if (totalQueued >= MAX_TOTAL_QUEUED) {
    throw new AgentMessagingError("too many messages in flight across the fleet", -32017);
  }

  const queue = queues.get(toAgentId) ?? [];
  if (queue.length >= MAX_QUEUE_PER_TARGET) {
    throw new AgentMessagingError("target's message queue is full", -32013);
  }

  const sender = getAgent(db, fromAgentId);
  const senderTask = sender?.taskDescription?.slice(0, 60) ?? "";
  const fromLabel = sender
    ? (sender.alias ?? `${sender.cliType}${senderTask ? ` · ${senderTask}` : ""}`)
    : "unknown";

  const senderProject = sender ? getProject(db, sender.projectId) : null;

  const record = sendMessage(db, {
    fromAgentId,
    toAgentId,
    type: "text",
    content: text,
    clientKey: input.clientKey ?? null,
    deliveryState: "queued",
  });
  const pending: PendingMessage = {
    messageId: record.id,
    fromAgentId,
    fromLabel,
    replyTarget: sender?.alias ?? fromAgentId,
    toAgentId,
    text,
    expectsReply: input.expectsReply ?? true,
    senderProject: senderProject ? { name: senderProject.name, path: senderProject.path } : null,
    crossProject: !!sender && sender.projectId !== target.projectId,
    inReplyTo: input.inReplyTo ?? null,
  };

  trackMessage(pending);
  if (!input.system) rememberSend(dedupKey, record.id, now);

  // Target at its prompt → inject immediately; otherwise queue for the boundary.
  // NEVER inject while it's on a permission dialog (see agentsAwaitingApproval).
  const atIdlePrompt =
    (target.status === "waiting_input" || target.status === "idle") &&
    !agentsAwaitingApproval.has(toAgentId);
  if (atIdlePrompt && injectNow(pending)) {
    setOutcome(record.id, "delivered");
    return { messageId: record.id, delivered: true };
  }
  queue.push(pending);
  queues.set(toAgentId, queue);
  ensureSweep();
  logger.info(
    `[AgentMsg] Queued ${record.id} ${fromAgentId} → ${toAgentId} (target ${target.status}, ${queue.length} pending)`,
  );
  return { messageId: record.id, delivered: false };
}

/**
 * Turn-boundary hook (called from broadcastAgentStatus when a live agent lands
 * on `waiting_input`): deliver ONE pending message — the rest wait for the
 * next boundary so replies interleave naturally instead of flooding the prompt.
 */
export function deliverPendingAgentMessages(agentId: string): void {
  // This IS the boundary: anything injected before it has now been read.
  markConsumed(agentId);
  const queue = queues.get(agentId);
  if (!queue?.length) return;
  const next = queue.shift();
  if (!next) return;
  if (!injectNow(next)) {
    // PTY gone — drop the queue; the messages stay persisted in the DB.
    setOutcome(next.messageId, "undeliverable");
    for (const p of queue) setOutcome(p.messageId, "undeliverable");
    queues.delete(agentId);
    logger.warn(
      `[AgentMsg] Target ${agentId} PTY gone — ${queue.length + 1} message(s) undeliverable`,
    );
    return;
  }
  setOutcome(next.messageId, "delivered");
  if (queue.length === 0) queues.delete(agentId);
}

// ─── Quiescence fallback ────────────────────────────────────────────────────
//
// Delivery waits for a turn boundary, but only providers with hooks (claude,
// codex) reliably emit one — opencode's TUI produces nothing the scraper
// recognizes, so a queued message sat there forever (live 2026-08-12). A PTY
// that has been silent for a few seconds is at its prompt: that's a boundary
// too, just observed instead of announced.
const QUIET_MS = 4_000;
// Long enough that a real boundary signal virtually always wins the race, short
// enough that a stalled queue is noticed within one coffee sip.
const BOUNDARY_STALL_MS = 60_000;
const SWEEP_MS = 2_000;
const lastOutputAt = new Map<string, number>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Called from the PTY data callback — cheap, one Map write per chunk. */
export function noteAgentOutput(agentId: string): void {
  lastOutputAt.set(agentId, Date.now());
}

// Agents whose provider announces turn boundaries deterministically (T123
// hooks / OSC). For them the quiescence fallback is not a safety net but a
// RACE: codex thinking for >4s with no output looked idle, so a message landed
// mid-generation — exactly what boundary delivery exists to prevent.
//
// It only DELAYS the fallback, never cancels it (see BOUNDARY_STALL_MS): a
// safety net you can switch off permanently is not a safety net, and there are
// real paths where the announced boundary never arrives — a permission prompt
// ends a turn too, and the following `finished` produces no idle transition.
const boundarySignalling = new Set<string>();

export function noteAgentBoundarySignal(agentId: string): void {
  boundarySignalling.add(agentId);
}

function stopSweep(): void {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

function sweepQuietAgents(): void {
  if (queues.size === 0) {
    stopSweep();
    return;
  }
  const now = Date.now();
  for (const agentId of [...queues.keys()]) {
    const last = lastOutputAt.get(agentId);
    // No output recorded yet means nothing has ever been written to that PTY —
    // treat it as quiet too, otherwise a silent agent never receives anything.
    const quietFor = last === undefined ? Number.POSITIVE_INFINITY : now - last;
    // Providers that announce boundaries get a long grace instead of an
    // exemption: normally their signal arrives first, but if it never does the
    // queue must not stall forever.
    const announces = boundarySignalling.has(agentId);
    if (quietFor < (announces ? BOUNDARY_STALL_MS : QUIET_MS)) continue;
    if (isEchoingInjection(agentId)) continue;
    if (agentsAwaitingApproval.has(agentId)) continue;
    if (announces) {
      logger.warn(
        `[AgentMsg] ${agentId} announces turn boundaries but none arrived in ${BOUNDARY_STALL_MS / 1000}s — delivering anyway`,
      );
    } else {
      logger.info(`[AgentMsg] Delivering to ${agentId} on quiescence (no boundary signal)`);
    }
    deliverPendingAgentMessages(agentId);
  }
}

function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepQuietAgents, SWEEP_MS);
  sweepTimer.unref?.();
}

// Every per-agent structure in one place. The hand-written delete list had
// already forgotten `agentsAwaitingApproval`, which leaked for each dead agent.
const PER_AGENT_STATE: Array<{ delete(key: string): unknown }> = [
  queues,
  boundarySignalling,
  agentsAwaitingApproval,
  sendTimestamps,
  lastOutputAt,
];

/**
 * Drop runtime state for a stopped/removed agent (messages stay in the DB as
 * an audit trail). With `db`, each sender waiting on an undelivered message is
 * told the session ended — otherwise it keeps waiting for a reply that can
 * never come (Antonio 2026-08-12: "si cerramos draco ya no debe tener en queue
 * peticiones a él").
 */
export function clearAgentMessageQueue(agentId: string, db?: Database.Database): void {
  const pending = queues.get(agentId);
  // Independent of the notification below: without `db` the states would stay
  // "queued" and message_status would then derive them as delivered — the map
  // lying about messages that were dropped.
  for (const p of pending ?? []) setOutcome(p.messageId, "undeliverable");
  if (db && pending?.length) {
    const gone = getAgent(db, agentId);
    const goneLabel = gone?.alias ?? agentId;
    const notified = new Set<string>();
    for (const p of pending) {
      if (notified.has(p.fromAgentId)) continue;
      notified.add(p.fromAgentId);
      try {
        sendAgentMessage(db, {
          fromAgentId: agentId,
          toAgentId: p.fromAgentId,
          text: `(system) Your message never reached "${goneLabel}" — that session ended before its next turn. Don't wait for a reply; ask the user or pick another agent from agents_list.`,
          expectsReply: false,
          system: true,
        });
      } catch (err) {
        logger.warn(`[AgentMsg] Could not notify ${p.fromAgentId} that ${agentId} died: ${err}`);
      }
    }
  }
  queues.delete(agentId);
  // Nothing left to watch — don't keep a timer alive for an empty fleet.
  if (queues.size === 0) stopSweep();
  // Its rate history and echo window die with it too — a new agent reusing the
  // id must not inherit them.
  for (const store of PER_AGENT_STATE) store.delete(agentId);
  forgetAgentMessageState(agentId);
  forgetAgentInjectionState(agentId);
}
