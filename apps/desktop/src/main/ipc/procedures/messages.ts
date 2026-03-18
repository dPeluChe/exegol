import { AGENT_MESSAGE_TYPES } from "@exegol/shared";
import { z } from "zod";
import {
  countUnread,
  listMessages,
  listMessagesBetween,
  markAllRead,
  markMessageRead,
  sendMessage,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const messagesRouter = router({
  send: publicProcedure
    .input(
      z.object({
        fromAgentId: z.string().nullable(),
        toAgentId: z.string().nullable(),
        type: z.enum(AGENT_MESSAGE_TYPES),
        content: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      return sendMessage(ctx.db, input);
    }),

  list: publicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          type: z.enum(AGENT_MESSAGE_TYPES).optional(),
          unreadOnly: z.boolean().optional(),
          limit: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return listMessages(
        ctx.db,
        {
          agentId: input?.agentId,
          type: input?.type,
          unreadOnly: input?.unreadOnly,
        },
        input?.limit ?? 100,
      );
    }),

  conversation: publicProcedure
    .input(
      z.object({
        agentA: z.string(),
        agentB: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return listMessagesBetween(ctx.db, input.agentA, input.agentB, input.limit ?? 100);
    }),

  markRead: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    markMessageRead(ctx.db, input.id);
    return { success: true };
  }),

  markAllRead: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(({ ctx, input }) => {
      markAllRead(ctx.db, input.agentId);
      return { success: true };
    }),

  unreadCount: publicProcedure.input(z.object({ agentId: z.string() })).query(({ ctx, input }) => {
    return { count: countUnread(ctx.db, input.agentId) };
  }),
});
