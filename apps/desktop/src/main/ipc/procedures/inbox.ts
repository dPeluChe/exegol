import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FollowUpError } from "../../agents/follow-up-queue";
import { listThreads } from "../../db/queries/inbox";
import { sendToSession } from "../../inbox/send-to-session";
import { close, giveLastTurn, InboxError, PERSON, readThread, replyTo } from "../../inbox/threads";
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
});
