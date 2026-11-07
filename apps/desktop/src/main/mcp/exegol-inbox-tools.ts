import { type InboxAuthor, type InboxThread, pathBase, pathParent } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getAgentCwd } from "../db/queries/agents";
import { colabsOfProject } from "../db/queries/colabs";
import { listThreads } from "../db/queries/inbox";
import { getProject } from "../db/queries/projects";
import {
  close,
  InboxError,
  type InboxTarget,
  openThread,
  readThread,
  replyTo,
  take,
} from "../inbox/threads";
import { runGit } from "../lib/worktree-safety";
import { type ExegolToolContext, ExegolToolError } from "./exegol-protocol";
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
async function authorOf(db: Database.Database, context: ExegolToolContext): Promise<InboxAuthor> {
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

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const summary = (t: InboxThread) => ({
  thread: t.id,
  scope: t.scope,
  title: t.title,
  status: t.status,
  resolution: t.resolution,
});

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Names, as an agent knows them from its instructions; only colabs this project is in */
function targetOf(
  db: Database.Database,
  args: Record<string, unknown>,
  projectId: string,
): InboxTarget {
  if (args.target === "personal") return { scope: "personal" };
  if (args.target !== "colab") return { scope: "project", projectId };
  const colabs = colabsOfProject(db, projectId);
  const colab = colabs.find((c) => same(c.name, text(args.colab)));
  if (!colab) {
    const names = colabs.map((c) => c.name).join(", ") || "none";
    throw new InboxError(
      `No colab named ${JSON.stringify(text(args.colab))} here. Yours: ${names}`,
    );
  }
  const wanted = text(args.to_project);
  if (!wanted) return { scope: "colab", colabId: colab.id, toProject: null };
  const members = colab.members.map((m) => getProject(db, m.projectId)).filter((p) => !!p);
  const to = members.find((p) => same(p.name, wanted));
  if (!to) {
    const names = [...new Set(members.map((p) => p.name))].join(", ");
    throw new InboxError(`${JSON.stringify(wanted)} is not in ${colab.name}. Members: ${names}`);
  }
  return { scope: "colab", colabId: colab.id, toProject: to.id };
}

type Handler = (
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) => unknown;

const HANDLERS: Record<InboxToolName, Handler> = {
  inbox_post: async (db, args, context) => {
    const opened = openThread(
      db,
      await authorOf(db, context),
      targetOf(db, args, context.projectId),
      {
        title: text(args.title),
        body: text(args.body),
        url: text(args.url) || null,
        refs: Array.isArray(args.refs) ? args.refs.map(String) : [],
      },
    );
    return { thread: opened.thread.id, similar_closed: opened.similarClosed.map(summary) };
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
    return {
      threads: listThreads(db, { projectId: context.projectId, state, query, limit }).map((t) => ({
        ...summary(t),
        kind: t.kind,
        last_activity_at: t.lastActivityAt,
        unread: t.lastSeq - (t.lastReadSeq ?? 0),
      })),
    };
  },

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
