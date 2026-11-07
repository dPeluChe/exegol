export const INBOX_TURN_LIMIT = 6;
export const INBOX_TITLE_MAX = 120;
export const INBOX_BODY_MAX = 8_000;
export const INBOX_RESOLUTION_MAX = 200;

export type InboxScope = "project" | "colab" | "personal";
export type InboxStatus = "open" | "in_progress" | "resolved" | "dismissed";
export type InboxCloseStatus = Extract<InboxStatus, "resolved" | "dismissed">;
export type InboxKind = "message" | "capture";
export type InboxAuthorKind = "user" | "agent" | "external";

export const isInboxClosed = (status: InboxStatus): boolean =>
  status === "resolved" || status === "dismissed";

export interface InboxThread {
  id: string;
  scope: InboxScope;
  scopeId: string | null;
  kind: InboxKind;
  title: string;
  url: string | null;
  status: InboxStatus;
  resolution: string | null;
  ownerProject: string | null;
  openedAt: number;
  lastActivityAt: number;
  refs: string[];
  /** Derived from the messages */
  agentTurns: number;
  lastSeq: number;
  openerAgent: string | null;
  lastTurn: boolean;
  /** The asking project's cursor; null for a person, or a project that never read it */
  lastReadSeq: number | null;
  /** The owner project's cursor, whoever asks: what Pending reads */
  ownerReadSeq: number | null;
  lastAuthorKind: InboxAuthorKind;
  lastAgent: string | null;
}

export interface InboxMessage {
  threadId: string;
  seq: number;
  body: string;
  authorKind: InboxAuthorKind;
  projectId: string | null;
  repo: string | null;
  agentId: string | null;
  cli: string | null;
  model: string | null;
  branch: string | null;
  commit: string | null;
  createdAt: number;
}

export type InboxAuthor = Pick<
  InboxMessage,
  "authorKind" | "projectId" | "repo" | "agentId" | "cli" | "model" | "branch" | "commit"
>;

/** Who is acting. A project is null for a person, who reaches every thread */
export type InboxActor = Pick<InboxAuthor, "authorKind" | "projectId" | "agentId">;

export const atInboxTurnLimit = (t: Pick<InboxThread, "agentTurns" | "lastTurn">): boolean =>
  t.agentTurns >= INBOX_TURN_LIMIT && !t.lastTurn;

export type InboxPendingState = "not_read" | "read_no_reply" | "needs_you" | "to_review";

export const INBOX_PENDING_LABEL: Record<InboxPendingState, string> = {
  not_read: "Not read",
  read_no_reply: "Read, no reply",
  needs_you: "Needs you",
  to_review: "To review",
};

/** Who an active thread waits on. Derived, never stored: it waits on whoever did not write last */
export function inboxPendingState(t: InboxThread): InboxPendingState {
  if (t.kind === "capture") return "to_review";
  if (t.scope === "personal" || atInboxTurnLimit(t)) return "needs_you";
  const onTheProject = t.lastTurn || t.lastAuthorKind !== "agent" || t.lastAgent === t.openerAgent;
  if (!onTheProject) return "needs_you";
  return (t.ownerReadSeq ?? 0) < t.lastSeq ? "not_read" : "read_no_reply";
}
