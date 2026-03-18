import { z } from "zod";
import { listActivities } from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const activitiesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          type: z.string().optional(),
          limit: z.number().default(100),
          since: z.number().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return listActivities(ctx.db, {
        projectId: input?.projectId,
        type: input?.type,
        limit: input?.limit,
        since: input?.since,
      });
    }),
});
