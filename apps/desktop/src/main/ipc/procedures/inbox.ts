import { INBOX_BODY_MAX, INBOX_TITLE_MAX } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FollowUpError } from "../../agents/follow-up-queue";
import { checkGitRepo } from "../../agents/preflight";
import { listThreads } from "../../db/queries/inbox";
import { getProject } from "../../db/queries/projects";
import { capture } from "../../inbox/capture";
import { forward } from "../../inbox/forward";
import { ISSUE_BODY_MAX, issueDraft, sendAsIssue } from "../../inbox/issue";
import { sendToSession, startSession } from "../../inbox/send-to-session";
import {
  close,
  giveLastTurn,
  InboxError,
  type InboxTarget,
  openThread,
  PERSON,
  readThread,
  replyTo,
} from "../../inbox/threads";
import { publicProcedure, router } from "../trpc";

const LIST_LIMIT = 200;
const threadId = z.object({ id: z.string() });
const target: z.ZodType<InboxTarget> = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("project"), projectId: z.string() }),
  z.object({ scope: z.literal("personal") }),
  z.object({ scope: z.literal("colab"), colabId: z.string(), toProject: z.string().nullable() }),
]);

function rethrow(err: unknown): never {
  if (err instanceof InboxError || err instanceof FollowUpError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

function inboxCall<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    rethrow(err);
  }
}

/** A person's side of the inbox: reaches every thread. Reading here moves no project's cursor */
export const inboxRouter = router({
  list: publicProcedure
    .input(z.object({ state: z.enum(["active", "closed"]) }))
    .query(({ ctx, input }) =>
      listThreads(ctx.db, {
        projectId: null,
        state: input.state,
        limit: LIST_LIMIT,
        oldestFirst: input.state === "active",
      }),
    ),

  get: publicProcedure
    .input(threadId)
    .query(({ ctx, input }) => inboxCall(() => readThread(ctx.db, PERSON, input.id, 0))),

  open: publicProcedure
    .input(
      z.object({
        title: z.string(),
        body: z.string(),
        projectId: z.string().nullable(),
        /** A colab thread, for one member (toProject) or all of them */
        colabId: z.string().optional(),
        toProject: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      inboxCall(() => {
        const { title, body, projectId, colabId } = input;
        const target: InboxTarget = colabId
          ? { scope: "colab", colabId, toProject: input.toProject ?? null }
          : projectId
            ? { scope: "project", projectId }
            : { scope: "personal" };
        const fields = { title, body, url: null, refs: [] };
        return { id: openThread(ctx.db, PERSON, target, fields).thread.id };
      }),
    ),

  reply: publicProcedure
    .input(threadId.extend({ body: z.string() }))
    .mutation(({ ctx, input }) => inboxCall(() => replyTo(ctx.db, PERSON, input.id, input.body))),

  close: publicProcedure
    .input(threadId.extend({ status: z.enum(["resolved", "dismissed"]), resolution: z.string() }))
    .mutation(({ ctx, input }) =>
      inboxCall(() => close(ctx.db, PERSON, input.id, input.status, input.resolution)),
    ),

  lastTurn: publicProcedure
    .input(threadId)
    .mutation(({ ctx, input }) => inboxCall(() => giveLastTurn(ctx.db, input.id))),

  capture: publicProcedure
    .input(
      z.object({
        target,
        title: z.string().max(INBOX_TITLE_MAX).nullable(),
        url: z.string().max(2_000).nullable(),
        text: z.string().max(INBOX_BODY_MAX).nullable(),
        note: z.string().max(500).nullable(),
      }),
    )
    .mutation(({ ctx, input: { target, ...fields } }) =>
      inboxCall(() => ({ id: capture(ctx.db, target, fields).id })),
    ),

  forward: publicProcedure
    .input(threadId.extend({ target }))
    .mutation(({ ctx, input }) =>
      inboxCall(() => ({ id: forward(ctx.db, input.id, input.target).id })),
    ),

  issueDraft: publicProcedure
    .input(threadId)
    .query(({ ctx, input }) => issueDraft(ctx.db, input.id).catch(rethrow)),

  sendAsIssue: publicProcedure
    .input(
      threadId.extend({
        repo: z.string(),
        title: z.string().max(256),
        body: z.string().max(ISSUE_BODY_MAX),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...fields } }) => ({
      url: await sendAsIssue(ctx.db, id, fields).catch(rethrow),
    })),

  sendToSession: publicProcedure
    .input(threadId.extend({ agentId: z.string() }))
    .mutation(({ ctx, input }) => inboxCall(() => sendToSession(ctx.db, input.id, input.agentId))),

  startSession: publicProcedure
    .input(threadId.extend({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId } = input;
      const path = getProject(ctx.db, projectId)?.path;
      const useWorktree = !!path && (await checkGitRepo(path));
      return {
        ...inboxCall(() => startSession(ctx.db, id, projectId)),
        useWorktree,
      };
    }),
});
