import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FollowUpError } from "../../agents/follow-up-queue";
import { checkGitRepo } from "../../agents/preflight";
import { listThreads } from "../../db/queries/inbox";
import { getProject } from "../../db/queries/projects";
import { sendToSession, startSession } from "../../inbox/send-to-session";
import {
  close,
  giveLastTurn,
  InboxError,
  openThread,
  PERSON,
  readThread,
  replyTo,
} from "../../inbox/threads";
import { readsExegolMcpConfig } from "../../mcp/exegol-mcp-config";
import { connectedAgentIds } from "../../mcp/exegol-tokens";
import { publicProcedure, router } from "../trpc";

const LIST_LIMIT = 200;
const threadId = z.object({ id: z.string() });

function inboxCall<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof InboxError || err instanceof FollowUpError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
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
    .input(z.object({ title: z.string(), body: z.string(), projectId: z.string().nullable() }))
    .mutation(({ ctx, input }) =>
      inboxCall(() => {
        const { title, body, projectId } = input;
        const target = projectId
          ? ({ scope: "project", projectId } as const)
          : ({ scope: "personal" } as const);
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

  sendToSession: publicProcedure
    .input(threadId.extend({ agentId: z.string() }))
    .mutation(({ ctx, input }) =>
      inboxCall(() =>
        sendToSession(ctx.db, input.id, input.agentId, connectedAgentIds().has(input.agentId)),
      ),
    ),

  startSession: publicProcedure
    .input(threadId.extend({ projectId: z.string(), cliType: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId, cliType } = input;
      const path = getProject(ctx.db, projectId)?.path;
      const useWorktree = !!path && (await checkGitRepo(path));
      return {
        ...inboxCall(() => startSession(ctx.db, id, projectId, readsExegolMcpConfig(cliType))),
        useWorktree,
      };
    }),
});
