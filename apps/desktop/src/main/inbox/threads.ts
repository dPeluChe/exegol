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
  isInboxClosed,
} from "@exegol/shared";
import type Database from "libsql";
import { isColabMember } from "../db/queries/colabs";
import {
  closeThread,
  getThread,
  grantLastTurn,
  insertMessage,
  insertThread,
  listMessages,
  listThreads,
  markRead,
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

/** Closed threads sharing at least two words of the title, or all of a short one */
function similarClosed(db: Database.Database, actor: InboxActor, thread: InboxThread) {
  const words = significantWords(thread.title);
  if (words.size === 0) return [];
  const needed = Math.min(2, words.size);
  return listThreads(db, { projectId: actor.projectId, state: "closed", limit: 200 })
    .filter((t) => !thread.refs.includes(t.id))
    .filter((t) => [...significantWords(t.title)].filter((w) => words.has(w)).length >= needed)
    .slice(0, 3);
}

export type InboxTarget =
  | { scope: "project"; projectId: string }
  | { scope: "personal" }
  | { scope: "colab"; colabId: string; toProject: string | null };

/** Where a thread goes and which project owns it. A colab takes members only, both ways */
function placed(db: Database.Database, author: InboxAuthor, target: InboxTarget) {
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
): { thread: InboxThread; similarClosed: InboxThread[] } {
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
  return { thread, similarClosed: similarClosed(db, author, thread) };
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

export function close(
  db: Database.Database,
  actor: InboxActor,
  key: string,
  status: InboxCloseStatus,
  resolution: string,
): void {
  const thread = reachable(db, actor, key);
  if (isInboxClosed(thread.status)) throw new InboxError(`${key} is already closed`);
  if (actor.agentId && thread.openerAgent === actor.agentId) {
    throw new InboxError("The session that opened a thread does not close it");
  }
  closeThread(db, key, status, bounded(resolution, INBOX_RESOLUTION_MAX, "resolution"));
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
