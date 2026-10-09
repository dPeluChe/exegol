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
  "idle", // at its prompt with no turn running: session start or the idle reminder
  "exited",
] as const;

export type AgentSignalType = (typeof AGENT_SIGNAL_TYPES)[number];

/** Claude Code Notification hook matcher: each notification_type that asks the user (an untyped
 *  dialog is permission_prompt). A plain name list is matched exactly, not as a regex. Not
 *  idle_prompt, the reminder 60s after every reply, which would mark idle agents as asking */
export const CLAUDE_ATTENTION_NOTIFICATIONS =
  "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|worker_permission_prompt";

/** Claude Code hooks that mean "at the prompt, no turn running": a cleared session, and
 *  idle_prompt (~60s after any idle start, and after an interrupted turn, which sends no Stop).
 *  Not startup|resume: they fire before a CLI-arg prompt is submitted. Not compact: mid-turn */
export const CLAUDE_SESSION_READY_SOURCES = "clear";
export const CLAUDE_IDLE_NOTIFICATIONS = "idle_prompt";

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
  | "budget:warning" // T147
  | "security:warning" // T166 — a credential written where it could be committed
  | "worktree:saved"; // a worktree's pending work committed and pushed to its branch

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

/** User-facing mute categories (T155.7). Persisted in settings + localStorage. */
export const NOTIFICATION_MUTE_CHANNELS = [
  "agent:attention",
  "agent:finished",
  "agent:failed",
  "warnings",
] as const;

export type NotificationMuteChannel = (typeof NOTIFICATION_MUTE_CHANNELS)[number];

/** Map a bus event to its mute category. `null` = never mutable (pipeline events). */
export function muteChannelForEvent(type: NotificationEventType): NotificationMuteChannel | null {
  switch (type) {
    case "agent:attention":
      return "agent:attention";
    case "agent:finished":
    case "worktree:saved":
      return "agent:finished";
    case "agent:failed":
    case "run:failed":
      return "agent:failed";
    case "resource:warning":
    case "budget:warning":
      return "warnings";
    // security:warning is deliberately absent: a credential written somewhere it
    // could be committed is not a preference, and muting it silently is the one
    // outcome that costs the user something they cannot undo.
    default:
      return null;
  }
}
