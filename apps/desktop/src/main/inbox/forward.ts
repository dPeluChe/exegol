import { INBOX_BODY_MAX, type InboxMessage, type InboxThread } from "@exegol/shared";
import type Database from "libsql";
import { closeThread, getThread, insertThread, listMessages } from "../db/queries/inbox";
import { getProject } from "../db/queries/projects";
import {
  InboxError,
  type InboxTarget,
  notifyInboxChanged,
  openThreadOrThrow,
  PERSON,
  placed,
} from "./threads";

const LEFT_OUT = "(earlier messages left out)";

/** Newest first until the room runs out, then shown oldest first */
export function transcript(
  db: Database.Database,
  thread: InboxThread,
  head: string,
  max = INBOX_BODY_MAX,
) {
  const names = new Map<string, string | undefined>();
  const author = (m: InboxMessage) => {
    if (m.authorKind === "user") return "You";
    if (m.authorKind === "external") return "Captured";
    const id = m.projectId;
    if (id && !names.has(id)) names.set(id, getProject(db, id)?.name);
    const project = id ? names.get(id) : null;
    return ["Agent", project, m.repo, m.cli, m.branch, m.commit].filter(Boolean).join(", ");
  };
  const messages = listMessages(db, thread.id);
  const kept: string[] = [];
  let room = max - head.length - LEFT_OUT.length - 4;
  for (const m of [...messages].reverse()) {
    const part = `${author(m)}, ${new Date(m.createdAt * 1000).toISOString()}:\n${m.body}`;
    if (kept.length > 0 && part.length + 2 > room) break;
    room -= part.length + 2;
    kept.unshift(part);
  }
  const cut = kept.length < messages.length ? [LEFT_OUT] : [];
  return [head, ...cut, ...kept].join("\n\n").slice(0, max);
}

/** A person moves a thread: a new one there carries the messages, this one closes pointing at it */
export function forward(db: Database.Database, key: string, target: InboxTarget): InboxThread {
  const thread = openThreadOrThrow(db, key);
  const { scopeId, toProject, owner } = placed(db, PERSON, target);
  if (
    thread.scope === target.scope &&
    thread.scopeId === scopeId &&
    thread.toProject === toProject
  ) {
    throw new InboxError(`${key} is already there`);
  }
  // insertThread runs its own transaction, and libsql does not nest them
  const moved = insertThread(
    db,
    {
      scope: target.scope,
      scopeId,
      toProject,
      ownerProject: owner,
      title: thread.title,
      url: thread.url,
      refs: thread.refs,
      forwardedFrom: key,
    },
    transcript(db, thread, `Forwarded from ${key}, ${JSON.stringify(thread.title)}.`),
    PERSON,
  );
  closeThread(db, key, "resolved", `Forwarded to ${moved}`);
  notifyInboxChanged();
  return getThread(db, moved, null) as InboxThread;
}
