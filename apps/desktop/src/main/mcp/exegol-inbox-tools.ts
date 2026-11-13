import {
  type Colab,
  type InboxAuthor,
  type InboxThread,
  pathBase,
  pathParent,
} from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getAgentCwd } from "../db/queries/agents";
import { listColabs } from "../db/queries/colabs";
import { listThreads } from "../db/queries/inbox";
import {
  close,
  InboxError,
  type InboxTarget,
  openThread,
  readThread,
  replyTo,
  take,
} from "../inbox/threads";
import { text } from "../lib/names";
import { runGit } from "../lib/worktree-safety";
import { type ExegolToolContext, ExegolToolError } from "./exegol-protocol";
import { colabNamed, colabTarget, colabView, placeOf, seenBy } from "./inbox-colabs";
import type { InboxToolName } from "./inbox-tool-defs";

const GIT_TIMEOUT_MS = 1_500;
const SHORT_COMMIT = 8;

async function gitFacts(cwd: string | null) {
  if (!cwd) return { repo: null, branch: null, commit: null };
  // The common dir names the repo from a worktree too, whose own folder says nothing
  const args = ["rev-parse", "--path-format=absolute", "--git-common-dir", "HEAD"];
  const out = await runGit([...args, "--abbrev-ref", "HEAD"], cwd, GIT_TIMEOUT_MS).catch(() => "");
  const [gitDir, commit, branch] = out.trim().split("\n");
  return {
    repo: gitDir ? pathBase(pathParent(gitDir)) : null,
    branch: branch && branch !== "HEAD" ? branch : null,
    commit: commit?.slice(0, SHORT_COMMIT) || null,
  };
}

/** Copied, not joined: a message outlives the session that wrote it */
export async function authorOf(
  db: Database.Database,
  context: ExegolToolContext,
): Promise<InboxAuthor> {
  const agent = getAgent(db, context.agentId);
  return {
    authorKind: "agent",
    projectId: context.projectId,
    agentId: context.agentId,
    cli: agent?.cliType ?? null,
    model: agent?.model ?? null,
    ...(await gitFacts(getAgentCwd(db, context.agentId))),
  };
}

const actorOf = (context: ExegolToolContext) => ({
  authorKind: "agent" as const,
  projectId: context.projectId,
  agentId: context.agentId,
});

const summary = (t: InboxThread) => ({
  thread: t.id,
  scope: t.scope,
  title: t.title,
  status: t.status,
  resolution: t.resolution,
});

function targetOf(colabs: Colab[], args: Record<string, unknown>, projectId: string): InboxTarget {
  if (args.target === "personal") return { scope: "personal" };
  if (args.target === "colab") return colabTarget(colabs, args, projectId);
  return { scope: "project", projectId };
}

const POSTED =
  "It waits and wakes nobody. To tell a live session now, agent_send it the thread id.";

type Handler = (
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) => unknown;

const HANDLERS: Record<InboxToolName, Handler> = {
  inbox_post: async (db, args, context) => {
    const colabs = listColabs(db, context.projectId);
    const opened = openThread(
      db,
      await authorOf(db, context),
      targetOf(colabs, args, context.projectId),
      {
        title: text(args.title),
        body: text(args.body),
        url: text(args.url) || null,
        refs: Array.isArray(args.refs) ? args.refs.map(String) : [],
      },
    );
    return {
      thread: opened.thread.id,
      scope: opened.thread.scope,
      ...placeOf(opened.thread, colabs),
      seen_by: seenBy(opened.thread, colabs, context.projectId),
      next: POSTED,
      similar_open: opened.similarOpen.map(summary),
      similar_closed: opened.similarClosed.map(summary),
    };
  },

  inbox_reply: async (db, args, context) => {
    const thread = text(args.thread);
    const seq = replyTo(db, await authorOf(db, context), thread, text(args.body));
    return { thread, seq, next: "Once the work is done, close it with inbox_close and one line." };
  },

  inbox_list: (db, args, context) => {
    const state = args.state === "closed" || args.state === "all" ? args.state : "active";
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const query = text(args.query) || undefined;
    const projectId = context.projectId;
    const colabs = listColabs(db, projectId);
    const colabId = text(args.colab) ? colabNamed(colabs, projectId, args.colab).id : undefined;
    return {
      threads: listThreads(db, { projectId, state, query, limit, colabId }).map((t) => ({
        ...summary(t),
        ...placeOf(t, colabs),
        kind: t.kind,
        last_activity_at: t.lastActivityAt,
        unread: t.lastSeq - (t.lastReadSeq ?? 0),
      })),
    };
  },

  colabs_list: (db, _args, context) => ({
    colabs: listColabs(db, context.projectId).map((c) => colabView(c, context.projectId)),
    note: "Only a person creates a colab or changes its members.",
  }),

  inbox_get: (db, args, context) => {
    const since = Math.max(Number(args.since_seq) || 0, 0);
    const { thread, messages, refs } = readThread(db, actorOf(context), text(args.thread), since);
    return {
      ...summary(thread),
      url: thread.url,
      last_seq: thread.lastSeq,
      refs: refs.map(summary),
      untrusted_inbox_content: messages.map((m) => ({
        seq: m.seq,
        author: m.authorKind,
        project: m.projectId,
        repo: m.repo,
        session: m.agentId,
        cli: m.cli,
        branch: m.branch,
        commit: m.commit,
        at: m.createdAt,
        body: m.body,
      })),
    };
  },

  inbox_take: (db, args, context) => {
    const thread = text(args.thread);
    return { thread, taken: take(db, actorOf(context), thread) };
  },

  inbox_close: (db, args, context) => {
    if (args.status !== "resolved" && args.status !== "dismissed") {
      throw new InboxError("status must be resolved or dismissed");
    }
    const thread = text(args.thread);
    close(db, actorOf(context), thread, args.status, text(args.resolution));
    return { thread, status: args.status };
  },
};

export async function callInboxTool(
  db: Database.Database,
  tool: InboxToolName,
  args: Record<string, unknown>,
  context: ExegolToolContext,
): Promise<unknown> {
  try {
    return await HANDLERS[tool](db, args, context);
  } catch (err) {
    if (err instanceof InboxError) throw new ExegolToolError(err.message, -32602);
    throw err;
  }
}
