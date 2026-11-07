export const INBOX_TURN_LIMIT = 6;

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
