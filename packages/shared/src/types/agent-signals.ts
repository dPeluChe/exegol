/**
 * Wave 2 shared contract — agent signals + notification events.
 *
 * WT-A (T123/T124) implements the producers; WT-B/C/D consume these types.
 * Do not fork these shapes locally — extend here and rebase.
 */

/** Deterministic agent lifecycle signals (T123: hooks + OSC 777 FSM). */
export const AGENT_SIGNAL_TYPES = [
  "started",
  "working",
  "attention", // agent is waiting for user input/approval
  "turn_started",
  "turn_ended",
  "finished",
  "exited",
] as const;

export type AgentSignalType = (typeof AGENT_SIGNAL_TYPES)[number];

/** Boundary validator: PTY-derived strings must be whitelisted before they
 *  flow through the contract as typed AgentSignalEvents. */
export function isKnownSignalType(value: string): value is AgentSignalType {
  return (AGENT_SIGNAL_TYPES as readonly string[]).includes(value);
}

export interface AgentSignalEvent {
  agentId: string;
  projectId: string;
  type: AgentSignalType;
  /** unix epoch ms */
  at: number;
  /** e.g. the pending question text for `attention`, exit code for `exited` */
  detail?: string;
  /** signal provenance: deterministic hook/OSC vs legacy scraping fallback */
  source: "hook" | "parser";
}

/** Turn boundaries consumed by T129 (oplog per-turn snapshots). */
export interface TurnBoundary {
  agentId: string;
  turnIndex: number;
  startedAt: number;
  endedAt?: number;
}

/** Events accepted by the NotificationBus (T124). Emitters anywhere in main. */
export type NotificationEventType =
  | "agent:attention"
  | "agent:finished"
  | "agent:failed"
  | "pipeline:paused"
  | "pipeline:completed"
  | "run:failed"
  | "resource:warning" // T143
  | "budget:warning"; // T147

export interface NotificationEvent {
  type: NotificationEventType;
  title: string;
  /** short human body, e.g. the agent's pending question */
  body?: string;
  agentId?: string;
  projectId?: string;
  /** unix epoch ms */
  at: number;
  /** channel-specific extras; keep JSON-serializable */
  meta?: Record<string, unknown>;
}
