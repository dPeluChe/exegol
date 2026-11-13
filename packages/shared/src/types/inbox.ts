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
  /** In a colab: the member project it is for; null for the whole colab */
  toProject: string | null;
  kind: InboxKind;
  title: string;
  url: string | null;
  status: InboxStatus;
  resolution: string | null;
  /** A close another project proposed, waiting for the project that opened the thread */
  closing: InboxCloseStatus | null;
  closingLine: string | null;
  ownerProject: string | null;
  /** The thread this one was forwarded from, closed when it was */
  forwardedFrom: string | null;
  openedAt: number;
  lastActivityAt: number;
  refs: string[];
  /** Derived from the messages */
  agentTurns: number;
  lastSeq: number;
  openerAgent: string | null;
  openerProject: string | null;
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

export type InboxPendingState =
  | "not_read"
  | "read_no_reply"
  | "needs_you"
  | "to_review"
  | "to_confirm";

export const INBOX_PENDING_LABEL: Record<InboxPendingState, string> = {
  not_read: "Not read",
  read_no_reply: "Read, no reply",
  needs_you: "Needs you",
  to_review: "To review",
  to_confirm: "To confirm",
};

/** The project a thread counts on: its own, or the colab member it is for */
export const inboxProjectOf = (t: Pick<InboxThread, "scope" | "scopeId" | "toProject">) =>
  t.scope === "project" ? t.scopeId : t.scope === "colab" ? t.toProject : null;

/** A proposed close waits for the project that opened the thread */
export const inboxAwaitsConfirmFrom = (
  t: Pick<InboxThread, "closing" | "openerProject">,
  projectId: string | null,
) => !!t.closing && !!projectId && t.openerProject === projectId;

/** What a project counts as its own: also a thread for the whole of a colab it is in, and one
 *  it opened whose close waits for it */
export const inboxCountsOn = (
  t: Pick<InboxThread, "scope" | "scopeId" | "toProject" | "closing" | "openerProject">,
  projectId: string,
  colabIds: ReadonlySet<string>,
) =>
  inboxProjectOf(t) === projectId ||
  (t.scope === "colab" && !t.toProject && colabIds.has(t.scopeId ?? "")) ||
  inboxAwaitsConfirmFrom(t, projectId);

/** A session of another project than the one whose session opened the thread proposes the close;
 *  the opener's side confirms it. A person, or the opener's own project, closes outright */
export const inboxCloseNeedsConfirm = (
  t: Pick<InboxThread, "openerAgent" | "openerProject">,
  actor: Pick<InboxActor, "projectId">,
) =>
  !!actor.projectId && !!t.openerAgent && !!t.openerProject && t.openerProject !== actor.projectId;

/** Who an active thread waits on. Derived, never stored: it waits on whoever did not write last */
export function inboxPendingState(t: InboxThread): InboxPendingState {
  if (t.kind === "capture") return "to_review";
  if (t.closing) return "to_confirm";
  if (t.scope === "personal" || atInboxTurnLimit(t)) return "needs_you";
  const onTheProject = t.lastTurn || t.lastAuthorKind !== "agent" || t.lastAgent === t.openerAgent;
  if (!onTheProject) return "needs_you";
  return (t.ownerReadSeq ?? 0) < t.lastSeq ? "not_read" : "read_no_reply";
}

/** What `exegol://capture` carried, before the person confirms it */
export interface CaptureLink {
  title: string | null;
  url: string | null;
  text: string | null;
}
