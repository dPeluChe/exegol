import { z } from "zod";
import { getAgentScore, getProjectScoringStats, listProjectScores } from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const scoringRouter = router({
  getScore: publicProcedure.input(z.object({ agentId: z.string() })).query(({ ctx, input }) => {
    return getAgentScore(ctx.db, input.agentId);
  }),

  listScores: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listProjectScores(ctx.db, input.projectId);
  }),

  stats: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return getProjectScoringStats(ctx.db, input.projectId);
  }),
});
