import type {
  InboxAuthor,
  InboxAuthorKind,
  InboxCloseStatus,
  InboxKind,
  InboxMessage,
  InboxScope,
  InboxStatus,
  InboxThread,
} from "@exegol/shared";
import type Database from "libsql";
import { z } from "zod";
import { parseJson } from "../../lib/parse-json";

const threadKey = (id: number): string => `inb_${id}`;

/** null for anything that is not an id this table gave out */
function threadRowId(key: string): number | null {
  const match = /^inb_(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

const REFS = z.array(z.string());

const now = () => Math.floor(Date.now() / 1000);

const THREAD_SELECT = `SELECT t.*, r.last_read_seq,
    (SELECT MAX(seq) FROM inbox_messages m WHERE m.thread_id = t.id) AS last_seq,
    (SELECT COUNT(*) FROM inbox_messages m WHERE m.thread_id = t.id AND m.author_kind = 'agent') AS agent_turns,
    o.agent_id AS opener_agent, o.project_id AS opener_project,
    (SELECT last_read_seq FROM inbox_reads o
      WHERE o.thread_id = t.id AND o.project_id = t.owner_project) AS owner_read_seq,
    (SELECT author_kind FROM inbox_messages m WHERE m.thread_id = t.id ORDER BY m.seq DESC LIMIT 1) AS last_author_kind,
    (SELECT agent_id FROM inbox_messages m WHERE m.thread_id = t.id ORDER BY m.seq DESC LIMIT 1) AS last_agent
  FROM inbox_threads t
  LEFT JOIN inbox_messages o ON o.thread_id = t.id AND o.seq = 1
  LEFT JOIN inbox_reads r ON r.thread_id = t.id AND r.project_id = @projectId`;

// The one reach rule. A null project is a person. A personal thread reaches a project through
// the read row a hand-over leaves; a colab thread reaches its members, for as long as they are
const REACH_SQL = `(@projectId IS NULL
  OR (t.scope = 'project' AND t.scope_id = @projectId)
  OR (t.scope = 'personal' AND r.thread_id IS NOT NULL)
  OR (t.scope = 'colab' AND EXISTS (SELECT 1 FROM colab_members cm
        WHERE cm.colab_id = t.scope_id AND cm.project_id = @projectId)))`;

function toThread(row: Record<string, unknown>): InboxThread {
  return {
    id: threadKey(row.id as number),
    scope: row.scope as InboxScope,
    scopeId: (row.scope_id as string) ?? null,
    toProject: (row.to_project as string) ?? null,
    kind: row.kind as InboxKind,
    title: row.title as string,
    url: (row.url as string) ?? null,
    status: row.status as InboxStatus,
    resolution: (row.resolution as string) ?? null,
    closing: (row.closing_status as InboxCloseStatus) ?? null,
    closingLine: (row.closing_line as string) ?? null,
    ownerProject: (row.owner_project as string) ?? null,
    forwardedFrom: row.forwarded_from ? threadKey(row.forwarded_from as number) : null,
    openedAt: row.opened_at as number,
    lastActivityAt: row.last_activity_at as number,
    refs: parseJson(row.refs as string, REFS) ?? [],
    agentTurns: row.agent_turns as number,
    lastSeq: (row.last_seq as number) ?? 0,
    openerAgent: (row.opener_agent as string) ?? null,
    openerProject: (row.opener_project as string) ?? null,
    lastTurn: row.last_turn === 1,
    lastReadSeq: (row.last_read_seq as number) ?? null,
    ownerReadSeq: (row.owner_read_seq as number) ?? null,
    lastAuthorKind: row.last_author_kind as InboxAuthorKind,
    lastAgent: (row.last_agent as string) ?? null,
  };
}

function toMessage(row: Record<string, unknown>): InboxMessage {
  return {
    threadId: threadKey(row.thread_id as number),
    seq: row.seq as number,
    body: row.body as string,
    authorKind: row.author_kind as InboxAuthorKind,
    projectId: (row.project_id as string) ?? null,
    repo: (row.repo as string) ?? null,
    agentId: (row.agent_id as string) ?? null,
    cli: (row.cli as string) ?? null,
    model: (row.model as string) ?? null,
    branch: (row.branch as string) ?? null,
    commit: (row.commit_sha as string) ?? null,
    createdAt: row.created_at as number,
  };
}

export function getThread(
  db: Database.Database,
  key: string,
  projectId: string | null,
): InboxThread | null {
  const id = threadRowId(key);
  if (id === null) return null;
  const row = db
    .prepare(`${THREAD_SELECT} WHERE t.id = @id AND ${REACH_SQL}`)
    .get({ id, projectId });
  return row ? toThread(row as Record<string, unknown>) : null;
}

function appendMessage(
  db: Database.Database,
  threadId: number,
  body: string,
  author: InboxAuthor,
): number {
  const at = now();
  const { seq } = db
    .prepare(
      `INSERT INTO inbox_messages
         (thread_id, seq, body, author_kind, project_id, repo, agent_id, cli, model, branch, commit_sha, created_at)
       VALUES (@threadId, (SELECT COALESCE(MAX(seq), 0) + 1 FROM inbox_messages WHERE thread_id = @threadId),
               @body, @authorKind, @projectId, @repo, @agentId, @cli, @model, @branch, @commit, @at)
       RETURNING seq`,
    )
    .get({ ...author, threadId, body, at }) as { seq: number };
  db.prepare(
    `UPDATE inbox_threads
     SET last_activity_at = ?, last_turn = CASE WHEN ? THEN 0 ELSE last_turn END
     WHERE id = ?`,
  ).run(at, author.authorKind === "agent" ? 1 : 0, threadId);
  return seq;
}

export function insertMessage(
  db: Database.Database,
  key: string,
  body: string,
  author: InboxAuthor,
): number {
  const threadId = threadRowId(key) as number;
  return db.transaction(() => appendMessage(db, threadId, body, author))();
}

export interface NewThread {
  scope: InboxScope;
  scopeId: string | null;
  toProject: string | null;
  title: string;
  url: string | null;
  ownerProject: string | null;
  refs: string[];
  forwardedFrom?: string;
  kind?: InboxKind;
}

/** The new thread's id */
export function insertThread(
  db: Database.Database,
  thread: NewThread,
  body: string,
  author: InboxAuthor,
): string {
  const { forwardedFrom, kind, ...fields } = thread;
  const create = db.transaction(() => {
    const at = now();
    const { id } = db
      .prepare(
        `INSERT INTO inbox_threads
           (scope, scope_id, to_project, title, url, owner_project, forwarded_from, opened_at,
            last_activity_at, refs, kind)
         VALUES (@scope, @scopeId, @toProject, @title, @url, @ownerProject, @from, @at, @at, @refs,
            @kind)
         RETURNING id`,
      )
      .get({
        ...fields,
        at,
        refs: JSON.stringify(fields.refs),
        from: forwardedFrom ? threadRowId(forwardedFrom) : null,
        kind: kind ?? "message",
      }) as { id: number };
    appendMessage(db, id, body, author);
    return threadKey(id);
  });
  return create();
}

export function listMessages(db: Database.Database, key: string, sinceSeq = 0): InboxMessage[] {
  const rows = db
    .prepare("SELECT * FROM inbox_messages WHERE thread_id = ? AND seq > ? ORDER BY seq")
    .all(threadRowId(key), sinceSeq) as Record<string, unknown>[];
  return rows.map(toMessage);
}

interface ThreadFilter {
  projectId: string | null;
  state: "active" | "closed" | "all";
  query?: string;
  /** Only this colab's threads */
  colabId?: string;
  limit: number;
  oldestFirst?: boolean;
}

const STATE_SQL = {
  active: "AND t.status IN ('open', 'in_progress')",
  closed: "AND t.status IN ('resolved', 'dismissed')",
  all: "",
};

export function listThreads(db: Database.Database, filter: ThreadFilter): InboxThread[] {
  const rows = db
    .prepare(
      `${THREAD_SELECT}
       WHERE ${REACH_SQL} ${STATE_SQL[filter.state]}
       AND (@like IS NULL OR t.title LIKE @like OR t.resolution LIKE @like)
       AND (@colabId IS NULL OR (t.scope = 'colab' AND t.scope_id = @colabId))
       ORDER BY ${filter.oldestFirst ? "t.last_activity_at, t.id" : "t.last_activity_at DESC, t.id DESC"}
       LIMIT @limit`,
    )
    .all({
      projectId: filter.projectId,
      limit: filter.limit,
      like: filter.query ? `%${filter.query}%` : null,
      colabId: filter.colabId ?? null,
    }) as Record<string, unknown>[];
  return rows.map(toThread);
}

// What a project counts as waiting on it: as `inboxCountsOn` (its last line is
// `inboxAwaitsConfirmFrom`), plus what the person handed it
const COUNTS_ON_SQL = `((t.scope = 'project' AND t.scope_id = @projectId)
  OR (t.scope = 'personal' AND r.thread_id IS NOT NULL)
  OR (t.scope = 'colab' AND (t.to_project = @projectId OR (t.to_project IS NULL
        AND EXISTS (SELECT 1 FROM colab_members cm
          WHERE cm.colab_id = t.scope_id AND cm.project_id = @projectId))))
  OR (t.closing_status IS NOT NULL AND @projectId = (SELECT project_id FROM inbox_messages m
        WHERE m.thread_id = t.id AND m.seq = 1)))`;

export function countActiveThreads(db: Database.Database, projectId: string): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inbox_threads t
       LEFT JOIN inbox_reads r ON r.thread_id = t.id AND r.project_id = @projectId
       WHERE ${COUNTS_ON_SQL} ${STATE_SQL.active}`,
    )
    .get({ projectId }) as { n: number };
  return n;
}

/** The person's own threads still open */
export function countPersonalThreads(db: Database.Database): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inbox_threads t WHERE t.scope = 'personal' ${STATE_SQL.active}`,
    )
    .get() as { n: number };
  return n;
}

export function markRead(db: Database.Database, key: string, projectId: string, seq: number): void {
  db.prepare(
    `INSERT INTO inbox_reads (thread_id, project_id, last_read_seq) VALUES (?, ?, ?)
     ON CONFLICT (thread_id, project_id)
     DO UPDATE SET last_read_seq = MAX(last_read_seq, excluded.last_read_seq)`,
  ).run(threadRowId(key), projectId, seq);
}

/** Compare-and-swap: of two sessions asking, one gets it */
export function takeThread(db: Database.Database, key: string): boolean {
  return (
    db
      .prepare("UPDATE inbox_threads SET status = 'in_progress' WHERE id = ? AND status = 'open'")
      .run(threadRowId(key)).changes === 1
  );
}

export function closeThread(
  db: Database.Database,
  key: string,
  status: InboxCloseStatus,
  resolution: string,
): void {
  db.prepare(
    `UPDATE inbox_threads
     SET status = ?, resolution = ?, closing_status = NULL, closing_line = NULL,
         last_activity_at = ? WHERE id = ?`,
  ).run(status, resolution, now(), threadRowId(key));
}

/** The thread stays active: its close waits for the side that opened it */
export function proposeClose(
  db: Database.Database,
  key: string,
  status: InboxCloseStatus,
  line: string,
): void {
  db.prepare("UPDATE inbox_threads SET closing_status = ?, closing_line = ? WHERE id = ?").run(
    status,
    line,
    threadRowId(key),
  );
}

export function dropProposal(db: Database.Database, key: string): void {
  db.prepare(
    "UPDATE inbox_threads SET closing_status = NULL, closing_line = NULL WHERE id = ?",
  ).run(threadRowId(key));
}

export function reopenThread(db: Database.Database, key: string): void {
  db.prepare("UPDATE inbox_threads SET status = 'open', resolution = NULL WHERE id = ?").run(
    threadRowId(key),
  );
}

/** The thread a forward moved this one to, if any */
export function forwardedTo(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT id FROM inbox_threads WHERE forwarded_from = ? LIMIT 1")
    .get(threadRowId(key)) as { id: number } | undefined;
  return row ? threadKey(row.id) : null;
}

/** Only where none was given: an issue link must not hide the thread's own */
export function setThreadUrl(db: Database.Database, key: string, url: string): void {
  db.prepare("UPDATE inbox_threads SET url = COALESCE(url, ?) WHERE id = ?").run(
    url,
    threadRowId(key),
  );
}

export function grantLastTurn(db: Database.Database, key: string): void {
  db.prepare("UPDATE inbox_threads SET last_turn = 1 WHERE id = ?").run(threadRowId(key));
}

export function threadsOpenedBySince(
  db: Database.Database,
  agentId: string,
  since: number,
): number {
  const { n } = db
    .prepare(
      "SELECT COUNT(*) AS n FROM inbox_messages WHERE agent_id = ? AND seq = 1 AND created_at >= ?",
    )
    .get(agentId, since) as { n: number };
  return n;
}

/** Active threads of a colab: one with any refuses to be deleted */
export function countColabActiveThreads(db: Database.Database, colabId: string): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inbox_threads t
       WHERE t.scope = 'colab' AND t.scope_id = ? ${STATE_SQL.active}`,
    )
    .get(colabId) as { n: number };
  return n;
}
