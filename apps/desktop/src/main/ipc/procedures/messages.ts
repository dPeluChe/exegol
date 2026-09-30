import { AGENT_MESSAGE_TYPES } from "@exegol/shared";
import { z } from "zod";
import { listMessages, listMessagesBetween } from "../../db/queries";
import { publicProcedure, router } from "../trpc";

/** Read-only: what agents told each other (sending goes through the Exegol MCP server, which
 *  derives the sender from its token and delivers at the receiver's turn boundary) */
export const messagesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          type: z.enum(AGENT_MESSAGE_TYPES).optional(),
          limit: z.number().int().positive().max(500).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      listMessages(ctx.db, { agentId: input?.agentId, type: input?.type }, input?.limit ?? 100),
    ),

  conversation: publicProcedure
    .input(
      z.object({
        agentA: z.string(),
        agentB: z.string(),
        limit: z.number().int().positive().max(500).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listMessagesBetween(ctx.db, input.agentA, input.agentB, input.limit ?? 100),
    ),
});
