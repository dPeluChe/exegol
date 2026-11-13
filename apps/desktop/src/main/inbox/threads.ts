import {
  atInboxTurnLimit,
  INBOX_BODY_MAX,
  INBOX_RESOLUTION_MAX,
  INBOX_TITLE_MAX,
  INBOX_TURN_LIMIT,
  type InboxActor,
  type InboxAuthor,
  type InboxCloseStatus,
  type InboxThread,
  inboxAwaitsConfirmFrom,
  inboxCloseNeedsConfirm,
  isInboxClosed,
} from "@exegol/shared";
import type Database from "libsql";
import { isColabMember } from "../db/queries/colabs";
import {
  closeThread,
  dropProposal,
  forwardedTo,
  getThread,
  grantLastTurn,
  insertMessage,
  insertThread,
  listMessages,
  listThreads,
  markRead,
  proposeClose,
  reopenThread,
  takeThread,
  threadsOpenedBySince,
} from "../db/queries/inbox";
import { broadcast } from "../lib/event-bus";

const MAX_REFS = 5;
const MAX_THREADS_PER_HOUR = 10;

export class InboxError extends Error {}

export const PERSON: InboxAuthor = {
  authorKind: "user",
  projectId: null,
  repo: null,
  agentId: null,
  cli: null,
  model: null,
  branch: null,
  commit: null,
};

/** Colabs ride the same push: their query sits under the "inbox" key */
export const notifyInboxChanged = () => broadcast("inbox:changed");

function bounded(value: string, max: number, name: string): string {
  const text = value.trim();
  if (!text) throw new InboxError(`${name} is required`);
  if (text.length > max) throw new InboxError(`${name} is too long (max ${max} characters)`);
  return text;
}

function reachable(db: Database.Database, actor: InboxActor, key: string): InboxThread {
  const thread = getThread(db, key, actor.projectId);
  if (!thread) throw new InboxError(`No inbox thread ${key} here`);
  return thread;
}

function checkRefs(db: Database.Database, actor: InboxActor, refs: string[]): void {
  if (refs.length > MAX_REFS) throw new InboxError(`At most ${MAX_REFS} refs`);
  for (const ref of refs) {
    if (!isInboxClosed(reachable(db, actor, ref).status)) {
      throw new InboxError(`${ref} is still open: reply there instead`);
    }
  }
}

const significantWords = (title: string) =>
  new Set(title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);

/** Other threads sharing at least two words of the title, or all of a short one: 3 open, 3 closed */
function similar(db: Database.Database, actor: InboxActor, thread: InboxThread) {
  const words = significantWords(thread.title);
  const needed = Math.min(2, words.size);
  const alike =
    words.size === 0
      ? []
      : listThreads(db, { projectId: actor.projectId, state: "all", limit: 400 })
          .filter((t) => t.id !== thread.id && !thread.refs.includes(t.id))
          .filter(
            (t) => [...significantWords(t.title)].filter((w) => words.has(w)).length >= needed,
          );
  return {
    similarOpen: alike.filter((t) => !isInboxClosed(t.status)).slice(0, 3),
    similarClosed: alike.filter((t) => isInboxClosed(t.status)).slice(0, 3),
  };
}

export type InboxTarget =
  | { scope: "project"; projectId: string }
  | { scope: "personal" }
  | { scope: "colab"; colabId: string; toProject: string | null };

/** Where a thread goes and which project owns it. A colab takes members only, both ways */
export function placed(db: Database.Database, author: InboxAuthor, target: InboxTarget) {
  if (target.scope === "personal") return { scopeId: null, toProject: null, owner: null };
  if (target.scope === "project") {
    return { scopeId: target.projectId, toProject: null, owner: target.projectId };
  }
  const { colabId, toProject } = target;
  if (author.projectId && !isColabMember(db, colabId, author.projectId)) {
    throw new InboxError("This project is not in that colab");
  }
  if (toProject && !isColabMember(db, colabId, toProject)) {
    throw new InboxError("That project is not in the colab");
  }
  return { scopeId: colabId, toProject, owner: toProject };
}

export interface ThreadFields {
  title: string;
  body: string;
  url: string | null;
  refs: string[];
}

export function openThread(
  db: Database.Database,
  author: InboxAuthor,
  target: InboxTarget,
  fields: ThreadFields,
): { thread: InboxThread; similarClosed: InboxThread[]; similarOpen: InboxThread[] } {
  if (author.agentId) {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    if (threadsOpenedBySince(db, author.agentId, hourAgo) >= MAX_THREADS_PER_HOUR) {
      throw new InboxError(`At most ${MAX_THREADS_PER_HOUR} threads an hour`);
    }
  }
  checkRefs(db, author, fields.refs);
  const { scopeId, toProject, owner } = placed(db, author, target);
  const key = insertThread(
    db,
    {
      scope: target.scope,
      scopeId,
      toProject,
      ownerProject: owner,
      title: bounded(fields.title, INBOX_TITLE_MAX, "title"),
      url: fields.url,
      refs: fields.refs,
    },
    bounded(fields.body, INBOX_BODY_MAX, "body"),
    author,
  );
  const thread = getThread(db, key, null) as InboxThread;
  notifyInboxChanged();
  return { thread, ...similar(db, author, thread) };
}

export function openThreadOrThrow(db: Database.Database, key: string): InboxThread {
  const thread = getThread(db, key, null);
  if (!thread) throw new InboxError(`No inbox thread ${key}`);
  if (isInboxClosed(thread.status)) throw new InboxError(`${key} is closed`);
  return thread;
}

export function replyTo(
  db: Database.Database,
  author: InboxAuthor,
  key: string,
  body: string,
): number {
  const thread = reachable(db, author, key);
  if (isInboxClosed(thread.status)) {
    throw new InboxError(
      `${key} is closed. If this came back, open a new thread with refs: ["${key}"]`,
    );
  }
  if (author.authorKind === "agent" && atInboxTurnLimit(thread)) {
    throw new InboxError(
      `${key} reached ${INBOX_TURN_LIMIT} agent messages and waits for a person`,
    );
  }
  const seq = insertMessage(db, key, bounded(body, INBOX_BODY_MAX, "body"), author);
  if (author.projectId) markRead(db, key, author.projectId, seq);
  // The side that confirms answered instead: there is more to do, the proposal is off
  if (thread.closing && confirms(thread, author)) dropProposal(db, key);
  notifyInboxChanged();
  return seq;
}

export function readThread(
  db: Database.Database,
  actor: InboxActor,
  key: string,
  sinceSeq: number,
) {
  const thread = reachable(db, actor, key);
  if (actor.projectId && thread.lastReadSeq !== thread.lastSeq) {
    markRead(db, key, actor.projectId, thread.lastSeq);
    notifyInboxChanged();
  }
  return {
    thread,
    messages: listMessages(db, key, sinceSeq),
    refs: thread.refs.map((ref) => reachable(db, actor, ref)),
  };
}

export function take(db: Database.Database, actor: InboxActor, key: string): boolean {
  reachable(db, actor, key);
  const taken = takeThread(db, key);
  if (taken) notifyInboxChanged();
  return taken;
}

/** Who settles a proposed close: a person, or the project that opened the thread */
const confirms = (thread: InboxThread, actor: InboxActor) =>
  actor.authorKind === "user" || inboxAwaitsConfirmFrom(thread, actor.projectId);

/** A person or the opener's side closes, with its own status; over a proposed close its line
 *  follows the proposed one, or stands for it when empty. A session of another project
 *  proposes: the thread stays active, the proposal kept as a message, until the opener's side
 *  confirms or answers (only while that project still reaches the thread) */
export function close(
  db: Database.Database,
  actor: InboxActor,
  key: string,
  status: InboxCloseStatus,
  resolution: string,
): "closed" | "proposed" {
  const thread = reachable(db, actor, key);
  if (isInboxClosed(thread.status)) throw new InboxError(`${key} is already closed`);
  if (inboxCloseNeedsConfirm(thread, actor) && getThread(db, key, thread.openerProject)) {
    const line = bounded(resolution, INBOX_RESOLUTION_MAX, "resolution");
    proposeClose(db, key, status, line);
    const seq = insertMessage(db, key, `Proposes to close as ${status}: ${line}`, {
      ...PERSON,
      ...actor,
    });
    if (actor.projectId) markRead(db, key, actor.projectId, seq);
    notifyInboxChanged();
    return "proposed";
  }
  if (actor.agentId && thread.openerAgent === actor.agentId && !thread.closing) {
    throw new InboxError("The session that opened a thread does not close it");
  }
  const line = [thread.closingLine, resolution.trim()].filter(Boolean).join(" / ");
  closeThread(db, key, status, bounded(line, INBOX_RESOLUTION_MAX, "resolution"));
  notifyInboxChanged();
  return "closed";
}

/** A person's call: the proposed close is off and the thread goes on */
export function keepOpen(db: Database.Database, key: string): void {
  if (!reachable(db, PERSON, key).closing) throw new InboxError(`${key} has no close to refuse`);
  dropProposal(db, key);
  notifyInboxChanged();
}

/** A person's call, never a session's: a closed thread is active again, and says what it was.
 *  A forwarded one stays closed: the thread it moved to is the live copy */
export function reopen(db: Database.Database, key: string): void {
  const thread = reachable(db, PERSON, key);
  if (!isInboxClosed(thread.status)) throw new InboxError(`${key} is not closed`);
  const moved = forwardedTo(db, key);
  if (moved) throw new InboxError(`${key} was forwarded: reopen ${moved}`);
  reopenThread(db, key);
  insertMessage(db, key, `Reopened. It was ${thread.status}: ${thread.resolution ?? ""}`, PERSON);
  notifyInboxChanged();
}

/** A person's call, only once the thread stopped at the limit */
export function giveLastTurn(db: Database.Database, key: string): void {
  if (!atInboxTurnLimit(reachable(db, PERSON, key))) {
    throw new InboxError(`${key} is not waiting at the turn limit`);
  }
  grantLastTurn(db, key);
  notifyInboxChanged();
}

/** The only way a personal thread reaches a project: the row is also the grant */
export function handOver(db: Database.Database, key: string, projectId: string): void {
  reachable(db, PERSON, key);
  markRead(db, key, projectId, 0);
}
