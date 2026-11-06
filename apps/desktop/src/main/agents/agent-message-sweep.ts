import { getDb } from "../db/client";
import { getAgent, isAgentQuiet } from "../db/queries/agents";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { isEchoingInjection } from "./agent-message-injection";
import { isAgentAwaitingApproval, needsUser, queuedAgentIds } from "./agent-message-queue";

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

/** Also the shutdown hook: nothing should keep a 2s interval alive past teardown. */
export function stopSweep(): void {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

// A numbered dialog with no selection raises no attention of its own, and the gate below never types into
// it: the queue would just wait, unseen. Told once per hold
const heldNoticed = new Set<string>();

function noticeHeldBehindDialog(agentId: string): void {
  if (heldNoticed.has(agentId)) return;
  heldNoticed.add(agentId);
  logger.warn(`[AgentMsg] ${agentId} has a queued message held behind a dialog on its screen`);
  try {
    const db = getDb();
    const agent = getAgent(db, agentId);
    if (!agent || isAgentQuiet(db, agentId)) return;
    const reason = "A message is held behind a dialog";
    getNotificationBus().emit({
      type: "agent:notice",
      title: `${agent.alias ?? agent.cliType}: ${reason}`,
      body: "Answer the dialog in its terminal to let it through",
      agentId,
      projectId: agent.projectId,
      at: Date.now(),
    });
    broadcast("agent:message-held", { agentId, reason });
  } catch (err) {
    logger.warn("[AgentMsg] held message notice failed:", err);
  }
}

function sweepQuietAgents(deliver: (agentId: string) => void): void {
  const agentIds = queuedAgentIds();
  for (const id of heldNoticed) if (!agentIds.includes(id)) heldNoticed.delete(id);
  if (agentIds.length === 0) {
    stopSweep();
    return;
  }
  for (const agentId of agentIds) {
    const quietFor = msSinceAgentOutput(agentId);
    // Providers that announce boundaries get a long grace instead of an
    // exemption: normally their signal arrives first, but if it never does the
    // queue must not stall forever.
    const announces = boundarySignalling.has(agentId);
    if (quietFor < (announces ? BOUNDARY_STALL_MS : QUIET_MS)) continue;
    if (isEchoingInjection(agentId)) continue;
    if (needsUser(agentId)) {
      if (!isAgentAwaitingApproval(agentId) && quietFor >= BOUNDARY_STALL_MS) {
        noticeHeldBehindDialog(agentId);
      }
      continue;
    }
    heldNoticed.delete(agentId);
    if (announces) {
      logger.warn(
        `[AgentMsg] ${agentId} announces turn boundaries but none arrived in ${BOUNDARY_STALL_MS / 1000}s — delivering anyway`,
      );
    } else {
      logger.info(`[AgentMsg] Delivering to ${agentId} on quiescence (no boundary signal)`);
    }
    deliver(agentId);
  }
}

export function ensureSweep(deliver: (agentId: string) => void): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepQuietAgents(deliver), SWEEP_MS);
  sweepTimer.unref?.();
}

/** No output recorded yet means nothing has ever been written to that PTY: quiet too, otherwise
 *  a silent agent never receives anything */
export function msSinceAgentOutput(agentId: string): number {
  const last = lastOutputAt.get(agentId);
  return last === undefined ? Number.POSITIVE_INFINITY : Date.now() - last;
}

/** When the session last printed, for readers that only look after something changed */
export function lastAgentOutput(agentId: string): number | undefined {
  return lastOutputAt.get(agentId);
}

export function forgetSweepState(agentId: string): void {
  lastOutputAt.delete(agentId);
  boundarySignalling.delete(agentId);
  heldNoticed.delete(agentId);
}
